import fs from "fs";
import path from "path";
import { createLogger } from "./logger.mjs";
import { resolveWorkspacePaths } from "./paths.mjs";
import {
  applyAgentSemanticProgress,
  applyAgentToolProgress,
  extractRoleInitialSummary,
  validateInitialSummary,
} from "@ludecker/aaac/run-engine/agent-progress-contract";
import {
  applyAgentComplete,
  mutateAgentManifest,
} from "@ludecker/aaac/run-engine/swarm-telemetry";
import { normalizeTokenSource } from "./phase-event-contract.mjs";
import { syncRunSidecars } from "@ludecker/aaac/run-engine/reconcile-run-status";

const log = createLogger("agentic-bridge:run-manifest");
const isoNow = () => new Date().toISOString();

function manifestPath(workspaceRoot, runId) {
  return path.join(resolveWorkspacePaths(workspaceRoot).runsRoot, runId, "run.json");
}

function appendLog(manifest, entry) {
  manifest.log = manifest.log ?? [];
  manifest.log.push({
    at: isoNow(),
    run_id: manifest.run_id,
    phase: entry.phase ?? manifest.phase,
    phase_kind: entry.phase_kind ?? manifest.phase_kind,
    skill: entry.skill ?? null,
    event: entry.event,
    detail: entry.detail,
    level: entry.level ?? "info",
  });
}

function mutateRun(workspaceRoot, runId, mutate) {
  return mutateAgentManifest(manifestPath(workspaceRoot, runId), mutate).manifest;
}

export function recordAgentLaunch(
  workspaceRoot,
  runId,
  {
    agentIndex,
    phase,
    subagentType = "generalPurpose",
    description = null,
    model = null,
    agentSpecId = null,
    agentSpecPath = null,
    initialSummary = null,
  } = {},
) {
  const specFile = agentSpecPath ? path.resolve(workspaceRoot, agentSpecPath) : null;
  const roleSummary =
    initialSummary ??
    (specFile && fs.existsSync(specFile)
      ? extractRoleInitialSummary(fs.readFileSync(specFile, "utf8"))
      : null);
  const semanticSummary = validateInitialSummary(roleSummary);
  if (agentSpecId && !semanticSummary) {
    throw new Error(`Agent spec ${agentSpecId} has no valid Role summary`);
  }
  const manifest = mutateRun(workspaceRoot, runId, (current) => {
    current.swarm = current.swarm ?? {};
    current.swarm.agents = current.swarm.agents ?? [];
    const launchIndex = (current.swarm.task_launches_this_phase ?? 0) + 1;
    current.swarm.task_launches_this_phase = launchIndex;
    current.swarm.phase = phase ?? current.phase;
    const startedAt = isoNow();
    current.swarm.agents.push({
      at: startedAt,
      started_at: startedAt,
      index: launchIndex,
      phase: phase ?? current.phase,
      subagent_type: subagentType,
      description: description ?? agentSpecId ?? `Agentic OS agent ${agentIndex + 1}`,
      ...(agentSpecId ? { agent_spec_id: agentSpecId } : {}),
      ...(agentSpecPath ? { agent_spec_path: agentSpecPath } : {}),
      ...(semanticSummary
        ? { initial_summary: semanticSummary, last_progress: semanticSummary }
        : {}),
      model,
      readonly: subagentType === "explore",
      origin: "agentic-os",
    });
    appendLog(current, {
      event: "agent_spawned",
      phase: phase ?? current.phase,
      detail: JSON.stringify({
        index: launchIndex,
        phase: phase ?? current.phase,
        started_at: startedAt,
        ...(agentSpecId ? { agent_spec_id: agentSpecId } : {}),
        ...(semanticSummary ? { initial_summary: semanticSummary } : {}),
        ...(model ? { model } : {}),
        origin: "agentic-os",
      }),
      level: "debug",
    });
  });
  log.info("record", "Agent launch recorded", { runId, phase, agentSpecId });
  return manifest;
}

export function persistSwarmExpectedSpecs(workspaceRoot, runId, agentSpecs) {
  return mutateRun(workspaceRoot, runId, (manifest) => {
    manifest.swarm = manifest.swarm ?? {};
    const phase = manifest.phase;
    const expected = (agentSpecs ?? []).map(
      ({ id, path: specPath, cursorPath, initial_summary: initialSummary }) => ({
        id,
        path: cursorPath ?? specPath,
        ...(initialSummary ? { initial_summary: initialSummary } : {}),
      }),
    );
    manifest.swarm.expected_agent_specs = expected;
    manifest.swarm.expected_specs_phase = phase;
    manifest.swarm_history = manifest.swarm_history ?? {};
    manifest.swarm_history[phase] = {
      ...(manifest.swarm_history[phase] ?? {}),
      expected_agent_specs: expected,
    };
  });
}

export function recordAgentToolProgress(
  workspaceRoot,
  runId,
  { phase, agentIndex = null, toolName, path: filePath = null } = {},
) {
  if (!toolName) return null;
  return mutateRun(workspaceRoot, runId, (manifest) => {
    const result = applyAgentToolProgress(manifest, {
      phase: phase ?? manifest.phase,
      agentIndex: agentIndex != null && agentIndex >= 0 ? agentIndex : undefined,
      toolName,
      path: filePath,
      filesSource: "metered_bridge",
      hook: { tool_name: toolName },
    });
    log.debug("record", "Bridge diagnostic meter applied", {
      runId,
      phase,
      toolName,
      mutation: result.mutation,
      agentIndex,
    });
  });
}

export function recordAgentSemanticProgress(
  workspaceRoot,
  runId,
  { phase, agentIndex = null, currentStep } = {},
) {
  return mutateRun(workspaceRoot, runId, (manifest) => {
    const result = applyAgentSemanticProgress(manifest, {
      phase: phase ?? manifest.phase,
      agentIndex: agentIndex != null && agentIndex >= 0 ? agentIndex : undefined,
      currentStep,
    });
    if (!result.applied) return;
    const phaseSlot = manifest.swarm.agents[result.arrayIndex]?.index ?? result.arrayIndex + 1;
    appendLog(manifest, {
      event: "agent_progress",
      phase: phase ?? manifest.phase,
      detail: JSON.stringify({
        agent_index: phaseSlot,
        semantic_summary: result.summary,
      }),
      level: "debug",
    });
  });
}

export function appendPhaseOutput(
  workspaceRoot,
  runId,
  { phase, detail, level = "info" } = {},
) {
  return mutateRun(workspaceRoot, runId, (manifest) => {
    appendLog(manifest, { event: "phase_output", phase, detail, level });
  });
}

function usageComponentFields(metrics, unavailable) {
  if (unavailable) {
    return {
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
    };
  }
  const fromComponents = metrics.components ?? {};
  const numberOrNull = (raw) => {
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
  };
  return {
    input_tokens:
      numberOrNull(metrics.inputTokens) ??
      numberOrNull(metrics.input_tokens) ??
      numberOrNull(fromComponents.input),
    output_tokens:
      numberOrNull(metrics.outputTokens) ??
      numberOrNull(metrics.output_tokens) ??
      numberOrNull(fromComponents.output),
    cache_read_tokens:
      numberOrNull(metrics.cacheReadTokens) ??
      numberOrNull(metrics.cache_read_tokens) ??
      numberOrNull(fromComponents.cacheRead),
    cache_write_tokens:
      numberOrNull(metrics.cacheWriteTokens) ??
      numberOrNull(metrics.cache_write_tokens) ??
      numberOrNull(fromComponents.cacheWrite),
  };
}

function persistCompletionMetricProvenance(manifest, completion, metrics) {
  const tokenSource = normalizeTokenSource(metrics.tokenSource) ?? "unavailable";
  completion.agentEntry.token_source = tokenSource;
  if (metrics.requestIds?.length) {
    completion.agentEntry.usage_request_ids = [...metrics.requestIds];
  }
  const completionLog = manifest.log?.at(-1);
  if (completionLog?.event === "agent_complete") {
    const parts = [
      completionLog.detail,
      `token_source=${tokenSource}`,
      completion.agentEntry.input_tokens != null
        ? `input=${completion.agentEntry.input_tokens}`
        : null,
      completion.agentEntry.output_tokens != null
        ? `output=${completion.agentEntry.output_tokens}`
        : null,
      completion.agentEntry.cache_read_tokens != null
        ? `cache_read=${completion.agentEntry.cache_read_tokens}`
        : null,
      completion.agentEntry.cache_write_tokens != null
        ? `cache_write=${completion.agentEntry.cache_write_tokens}`
        : null,
    ];
    completionLog.detail = parts.filter(Boolean).join(" ");
  }
}

export function recordAgentComplete(
  workspaceRoot,
  runId,
  { phase, agentIndex, finalSummary, cursorRunId = null, metrics = {} } = {},
) {
  const tokenSource = normalizeTokenSource(metrics.tokenSource) ?? "unavailable";
  const metricsUnavailable = tokenSource === "unavailable";
  const components = usageComponentFields(metrics, metricsUnavailable);
  const manifest = mutateRun(workspaceRoot, runId, (current) => {
    const completion = applyAgentComplete(current, {
      agentIndex,
      phase,
      finalSummary,
      cursorRunId,
      tokens: metricsUnavailable ? null : metrics.tokens ?? null,
      context: metricsUnavailable ? null : metrics.context ?? null,
      tokenSource,
      ...components,
    });
    persistCompletionMetricProvenance(current, completion, {
      ...metrics,
      tokenSource,
    });
  });
  log.info("record", "Agent completion recorded", { runId, phase, agentIndex });
  return manifest;
}

export function createAgentPhaseEventPersistence(
  workspaceRoot,
  runId,
  phase,
  agentIndex,
) {
  return {
    recordTool: (event) => recordAgentToolProgress(workspaceRoot, runId, {
      phase, agentIndex, toolName: event.toolName, path: event.path ?? null,
    }),
    recordProgress: (event) => recordAgentSemanticProgress(workspaceRoot, runId, {
      phase, agentIndex, currentStep: event.semanticSummary,
    }),
    recordComplete: (event) => recordAgentComplete(workspaceRoot, runId, {
      phase,
      agentIndex,
      finalSummary: event.finalSummary,
      cursorRunId: event.cursorRunId ?? null,
      metrics: event.metrics ?? {},
    }),
  };
}

export function failRun(workspaceRoot, runId, reason) {
  const manifest = mutateRun(workspaceRoot, runId, (current) => {
    current.status = "failed";
    current.blocked_reason = reason;
    appendLog(current, {
      event: "run_failed",
      phase: current.phase,
      detail: reason,
      level: "error",
    });
  });
  process.env.AAAC_WORKSPACE_ROOT = workspaceRoot;
  syncRunSidecars(manifest);
  log.warn("fail", "Run marked failed", { runId, reason });
  return manifest;
}
