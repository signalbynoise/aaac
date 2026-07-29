import { EventEmitter } from "events";
import { createLogger } from "./logger.mjs";
import {
  advancePhase,
  readRunManifestForExecution as readRunManifest,
} from "./dispatch.mjs";
import { createCursorLocalAdapter } from "./cursor-adapter.mjs";
import {
  composeSwarmAgentPrompt,
  composeSwarmCheckpointPrompt,
  getSwarmAgentSpecs,
  getAgentInitialSummary,
} from "./prompt-compose.mjs";
import { RunWatcher } from "./run-watcher.mjs";
import {
  getMissingPhaseArtifacts,
  getSwarmTarget,
  refreshPhaseSwarmTarget,
} from "./run-engine-loader.mjs";
import {
  recordAgentLaunch,
  appendPhaseOutput,
  createAgentPhaseEventPersistence,
  failRun,
  persistSwarmExpectedSpecs,
} from "./run-manifest.mjs";
import { persistAgentPhaseEvent } from "./phase-event-contract.mjs";
import { loadPhasesConfig, resolveSubagentTypeForPhase }
  from "@ludecker/aaac/run-engine/swarm-agent-specs";
import { resolveWorkspacePaths } from "./paths.mjs";
const log = createLogger("agentic-bridge:phase-runner");
function isGatePhaseEntry(manifest, phase, workspaceRoot) {
  if (manifest?.phase_kind === "gate") return true;
  const { aaacRoot } = resolveWorkspacePaths(workspaceRoot);
  const phasesConfig = loadPhasesConfig(aaacRoot);
  return phasesConfig?.phases?.[phase]?.gate === true;
}
async function getSwarmCount(phase, manifest, workspaceRoot, runId) {
  return getSwarmTarget(workspaceRoot, phase, manifest, { runId });
}
export class PhaseRunner extends EventEmitter {
  constructor(workspaceRoot, { adapter = null } = {}) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.adapter = adapter ?? createCursorLocalAdapter();
    this.watcher = new RunWatcher(workspaceRoot);
    this.activeRunId = null;
    this.executingRunIds = new Set();
    this.abortController = null;
    this.approvalResolvers = new Map();
  }
  startWatching() {
    this.watcher.on("event", (event) => this.emit("run-event", event));
    this.watcher.watchRun();
  }
  stopWatching() {
    this.watcher.close();
  }
  waitForApproval(runId) {
    return new Promise((resolve) => {
      this.approvalResolvers.set(runId, resolve);
    });
  }
  resolveApproval(runId, approved, reason) {
    const resolver = this.approvalResolvers.get(runId);
    if (resolver) {
      resolver(approved);
      this.approvalResolvers.delete(runId);
    } else if (reason) {
      log.debug("approve", "No approval waiter for run", { runId, approved, reason });
    }
  }
  async runSingleAgent(runId, manifest, phase, agentIndex, count, prompt, agentSpec) {
    const { aaacRoot } = resolveWorkspacePaths(this.workspaceRoot);
    const phasesConfig = loadPhasesConfig(aaacRoot);
    const subagentType = resolveSubagentTypeForPhase(phase, phasesConfig);
    const initialSummary = getAgentInitialSummary(this.workspaceRoot, agentSpec);
    recordAgentLaunch(this.workspaceRoot, runId, {
      agentIndex,
      phase,
      subagentType,
      model: process.env.CURSOR_MODEL ?? null,
      description: agentSpec?.id ?? `${phase} swarm agent ${agentIndex + 1}/${count}`,
      agentSpecId: agentSpec?.id ?? null,
      agentSpecPath: agentSpec?.cursorPath ?? null,
      initialSummary,
    });
    const persistence = createAgentPhaseEventPersistence(
      this.workspaceRoot, runId, phase, agentIndex,
    );
    for await (const event of this.adapter.runPhase({
      workspaceRoot: this.workspaceRoot,
      runId,
      phase,
      manifest,
      prompt,
      agentIndex,
      initialSummary,
    })) {
      this.emit("phase-event", { runId, agentIndex, ...event });
      persistAgentPhaseEvent(event, persistence);
      if (event.type === "failed") throw new Error(event.detail);
    }
  }
  async runOrchestratorCheckpoint(runId, manifest, phase, swarmAgentCount) {
    const missing = await getMissingPhaseArtifacts(
      this.workspaceRoot,
      runId,
      phase,
      manifest,
    );
    if (missing.length === 0) return;
    const prompt = composeSwarmCheckpointPrompt(
      this.workspaceRoot,
      manifest,
      phase,
      swarmAgentCount,
      missing,
    );
    const missingNames = missing.map((rel) => String(rel).replace(/^artifacts\//, "")).join(", ");
    const synthesizingDetail = `Synthesizing phase artifacts (${missingNames})…`;
    log.info("checkpoint", "Synthesizing swarm checkpoint artifacts", {
      runId,
      phase,
      missing,
    });
    appendPhaseOutput(this.workspaceRoot, runId, {
      phase,
      detail: synthesizingDetail,
      level: "info",
    });
    for await (const event of this.adapter.runPhase({
      workspaceRoot: this.workspaceRoot,
      runId,
      phase,
      manifest,
      prompt,
    })) {
      this.emit("phase-event", { runId, agentIndex: null, checkpoint: true, ...event });
      if (event.type === "failed") throw new Error(event.detail);
    }
  }
  async runAgentWave(
    runId,
    manifest,
    phase,
    agentOffset,
    agentCount,
    waveCount,
    agentSpecs,
  ) {
    const serialize =
      process.env.CURSOR_SERIALIZE_AGENTS === '1' ||
      process.env.SWARM_SERIALIZE_CURSOR === '1';
    if (serialize) {
      for (let index = 0; index < waveCount; index += 1) {
        const agentIndex = agentOffset + index;
        const agentSpec = agentSpecs[agentIndex] ?? null;
        const prompt = composeSwarmAgentPrompt(
          this.workspaceRoot, manifest, phase, agentIndex, agentCount, agentSpec,
        );
        await this.runSingleAgent(
          runId, manifest, phase, agentIndex, agentCount, prompt, agentSpec,
        );
      }
      return;
    }
    const tasks = [];
    for (let index = 0; index < waveCount; index += 1) {
      const agentIndex = agentOffset + index;
      const agentSpec = agentSpecs[agentIndex] ?? null;
      const prompt = composeSwarmAgentPrompt(
        this.workspaceRoot, manifest, phase, agentIndex, agentCount, agentSpec,
      );
      tasks.push(this.runSingleAgent(
        runId, manifest, phase, agentIndex, agentCount, prompt, agentSpec,
      ));
    }
    await Promise.all(tasks);
  }
  async preparePhaseAgentPlan(runId, manifest, phase) {
    let refreshed = readRunManifest(this.workspaceRoot, runId) ?? manifest;
    if (isGatePhaseEntry(refreshed, phase, this.workspaceRoot)) {
      refreshed =
        (await refreshPhaseSwarmTarget(this.workspaceRoot, runId, phase)) ?? refreshed;
      log.info("swarm", "Refreshed gate phase swarm target from manifest", {
        runId,
        phase,
        target: refreshed?.swarm?.target_agents?.[phase] ?? null,
        scope: refreshed?.complexity?.scope_score ?? null,
        change: refreshed?.complexity?.change_score ?? null,
      });
    }
    const count = await getSwarmCount(phase, refreshed, this.workspaceRoot, runId);
    const swarmRequired = Number(count) > 0;
    const agentCount = swarmRequired ? Number(count) : 1;
    const agentSpecs = getSwarmAgentSpecs(
      this.workspaceRoot,
      refreshed,
      phase,
      agentCount,
    ).map((spec) => ({
      ...spec,
      initial_summary: getAgentInitialSummary(this.workspaceRoot, spec),
    }));
    persistSwarmExpectedSpecs(this.workspaceRoot, runId, agentSpecs);
    if (swarmRequired && agentSpecs.length === 0) {
      throw new Error(`Swarm-required phase ${phase} has no graph agent roster`);
    }
    const wavePlan = refreshed.swarm?.wave_plan?.[phase]?.waves;
    const waves =
      Array.isArray(wavePlan) && wavePlan.length > 0 ? wavePlan : [agentCount];
    const plannedAgentCount = waves.reduce(
      (total, waveSize) => total + Math.max(1, Number(waveSize) || 1),
      0,
    );
    if (swarmRequired && plannedAgentCount !== agentCount) {
      throw new Error(`Swarm wave plan for ${phase} has ${plannedAgentCount} slots; expected ${agentCount}`);
    }
    return { refreshed, agentCount, agentSpecs, waves };
  }
  async runPhaseAgents(runId, phase, plan) {
    const { refreshed, agentCount, agentSpecs, waves } = plan;
    let agentOffset = 0;
    for (const waveSize of waves) {
      const waveCount = Math.max(1, waveSize);
      await this.runAgentWave(
        runId, refreshed, phase, agentOffset, agentCount, waveCount, agentSpecs,
      );
      agentOffset += waveCount;
    }
    await this.runOrchestratorCheckpoint(runId, refreshed, phase, agentCount);
  }
  async executeRun(runId) {
    if (this.executingRunIds.has(runId)) {
      log.warn("execute", "Run already executing", { runId });
      return;
    }
    process.env.AAAC_WORKSPACE_ROOT = this.workspaceRoot;
    this.activeRunId = runId;
    this.executingRunIds.add(runId);
    this.watcher.watchRun(runId);
    log.info("execute", "Starting run execution", { runId });
    try {
      await this._executeRunLoop(runId);
    } finally {
      this.executingRunIds.delete(runId);
      if (this.activeRunId === runId) {
        this.activeRunId = null;
      }
    }
  }
  async resolveRunBoundary(runId, manifest) {
    if (manifest.status === "completed") {
      this.emit("run-complete", { runId, manifest });
      return "stop";
    }
    if (manifest.status === "failed" || manifest.status === "cancelled") {
      this.emit("run-failed", { runId, manifest });
      return "stop";
    }
    if (!manifest.awaiting_approval && manifest.status !== "blocked") return "execute";
    this.emit("approval-required", { runId, manifest });
    const approved = await this.waitForApproval(runId);
    if (approved) return "retry";
    failRun(this.workspaceRoot, runId, "Rejected at approval gate");
    this.emit("run-failed", {
      runId,
      manifest: readRunManifest(this.workspaceRoot, runId),
    });
    return "stop";
  }
  async executeCurrentPhase(runId, manifest) {
    const phase = manifest.phase;
    if (!phase) return "stop";
    try {
      const plan = await this.preparePhaseAgentPlan(runId, manifest, phase);
      this.emit("phase-start", { runId, phase, manifest: plan.refreshed });
      log.info("phase", "Executing phase", { runId, phase });
      await this.runPhaseAgents(runId, phase, plan);
      const advance = await advancePhase(this.workspaceRoot, runId, phase);
      if (advance.ok) {
        this.emit("phase-complete", { runId, phase });
        return "retry";
      }
      const refreshed = readRunManifest(this.workspaceRoot, runId);
      if (refreshed?.awaiting_approval) return "retry";
      if (refreshed?.completed?.includes(phase)) {
        log.info("phase", "Phase already advanced", { runId, phase });
        this.emit("phase-complete", { runId, phase });
        return "retry";
      }
      const reason = advance.stderr?.trim() || `advance-phase failed for ${phase}`;
      failRun(this.workspaceRoot, runId, reason);
      this.emit("run-failed", {
        runId,
        manifest: readRunManifest(this.workspaceRoot, runId),
      });
      return "stop";
    } catch (err) {
      const reason = String(err);
      log.error("phase", "Phase failed", { runId, phase, error: reason });
      failRun(this.workspaceRoot, runId, reason);
      this.emit("phase-failed", { runId, phase, error: reason });
      this.emit("run-failed", {
        runId,
        manifest: readRunManifest(this.workspaceRoot, runId),
      });
      return "stop";
    }
  }
  async _executeRunLoop(runId) {
    while (true) {
      const manifest = readRunManifest(this.workspaceRoot, runId);
      if (!manifest) throw new Error(`Run not found: ${runId}`);
      const boundary = await this.resolveRunBoundary(runId, manifest);
      if (boundary === "stop") break;
      if (boundary === "retry") continue;
      if (await this.executeCurrentPhase(runId, manifest) === "stop") break;
    }
  }
  async cancel(runId) {
    await this.adapter.cancel(runId);
    failRun(this.workspaceRoot, runId, "Cancelled from Agentic OS");
    this.emit("run-cancelled", { runId });
  }
}
