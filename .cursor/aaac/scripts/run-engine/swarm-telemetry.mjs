/**
 * Shared swarm metrics and lifecycle rollups.
 * Semantic agent progress is owned by agent-progress-contract.mjs.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { isoNow, REPO_ROOT } from "./lib.mjs";
import { recordLog } from "./log.mjs";
import {
  resolveConversationContextMetrics,
  applyConversationContextMetrics,
} from "./conversation-context.mjs";
import {
  applyAgentComplete as applyAgentCompleteContract,
  applyAgentSemanticProgress,
  applyAgentToolProgress,
  classifyToolFileMutation,
  extractRoleInitialSummary,
  findAgentArrayIndexByPhasePosition,
  findAgentArrayIndexBySubagentId,
  findAgentIndexToComplete,
  filterAgentsToLatestPhaseAttempt,
  latestPhaseAttemptStartAt,
  normalizeSubagentId,
  formatHookProgressSummary,
  validateCurrentStep,
} from "./agent-progress-contract.mjs";

export * from "./agent-progress-contract.mjs";

const LOCK_RETRIES = 40, LOCK_WAIT_MS = 25, LOCK_STALE_MS = 30_000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function removeStaleLock(lockPath, staleMs, waitMs) {
  try {
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (age > staleMs) fs.unlinkSync(lockPath);
    else sleep(waitMs);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function acquireManifestLock(lockPath, options) {
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  for (let attempt = 0; attempt < (options.retries ?? LOCK_RETRIES); attempt += 1) {
    try {
      const lockHandle = fs.openSync(lockPath, "wx");
      fs.writeFileSync(lockHandle, JSON.stringify({
        pid: process.pid, hostname: os.hostname(), acquired_at: isoNow(),
      }));
      return lockHandle;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      removeStaleLock(lockPath, staleMs, options.waitMs ?? LOCK_WAIT_MS);
    }
  }
  return null;
}

function writeManifestAtomically(manifestPath, manifest) {
  const name = `.${path.basename(manifestPath)}.${process.pid}.${Date.now()}.tmp`;
  const tempPath = path.join(path.dirname(manifestPath), name);
  fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(tempPath, manifestPath);
}

export function mutateAgentManifest(manifestPath, mutate, options = {}) {
  const lockPath = `${manifestPath}.agent-progress.lock`;
  const lockHandle = acquireManifestLock(lockPath, options);
  if (lockHandle == null) throw new Error(`Timed out acquiring agent progress lock for ${manifestPath}`);
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const result = mutate(manifest);
    manifest.updated_at = isoNow();
    writeManifestAtomically(manifestPath, manifest);
    return { manifest, result };
  } finally {
    fs.closeSync(lockHandle);
    fs.rmSync(lockPath, { force: true });
  }
}

export function applyAgentComplete(manifest, options = {}) {
  const result = applyAgentCompleteContract(manifest, options);
  const entry = result.agentEntry;
  recordLog(manifest, {
    event: "agent_complete",
    phase: entry.phase,
    phase_kind: manifest.phase_kind,
    detail: [
      `agent_index=${result.phaseSlot}`,
      entry.tokens != null ? `tokens=${entry.tokens}` : null,
      entry.context != null ? `context=${entry.context}` : null,
      entry.input_tokens != null ? `input=${entry.input_tokens}` : null,
      entry.output_tokens != null ? `output=${entry.output_tokens}` : null,
      entry.cache_read_tokens != null ? `cache_read=${entry.cache_read_tokens}` : null,
      entry.cache_write_tokens != null ? `cache_write=${entry.cache_write_tokens}` : null,
      entry.duration_ms != null ? `duration_ms=${entry.duration_ms}` : null,
    ].filter(Boolean).join(" "),
    level: "debug",
  });
  return result;
}

export function bumpAgentFileCounters(agent, mutation) {
  const next = { ...agent };
  if (mutation === "read") next.files_read = Math.max(0, Number(next.files_read ?? 0)) + 1;
  if (mutation === "written") next.files_written = Math.max(0, Number(next.files_written ?? 0)) + 1;
  if (mutation === "edited") next.files_edited = Math.max(0, Number(next.files_edited ?? 0)) + 1;
  return next;
}

export function parseMetricFromDetail(detail, key) {
  const match = String(detail ?? "").match(new RegExp(`${key}=(\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : null;
}

export function estimateUsageFromText(prompt = "", output = "") {
  return estimateUsageFromCharCount(String(prompt).length + String(output).length);
}

export function estimateUsageFromCharCount(totalChars = 0) {
  const tokens = Math.max(1, Math.round(Number(totalChars) / 4));
  const modelContext = Number(process.env.CURSOR_MODEL_CONTEXT ?? 200_000);
  return { tokens, context: Math.min(100, Math.round((tokens / modelContext) * 10000) / 100) };
}

export function formatAgentMetricsDetail(metrics) {
  const parts = [];
  if (metrics?.tokens != null) parts.push(`tokens=${metrics.tokens}`);
  if (metrics?.context != null) parts.push(`context=${Number(metrics.context).toFixed(2)}`);
  return parts.join(" ");
}

export function durationMsBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return ms >= 0 ? ms : null;
}

export function findPhaseStartAt(manifest, phase) {
  return latestPhaseAttemptStartAt(manifest.log, phase);
}

export function computePhaseDurationMs(manifest, phase, completedAt = isoNow()) {
  return durationMsBetween(findPhaseStartAt(manifest, phase), completedAt);
}

export function formatAgentSpawnDetail(phase, launchIndex, description) {
  return String(description ?? "").trim() || `${phase} agent ${launchIndex} started`;
}

/** Stage-summary compatibility helper; agent summaries use the stricter semantic contract. */
export function formatSealedLaymanSummary(value) {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/#{1,6}\s*/g, "").replace(/[*`]+/g, "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((line) => (line.length > 120 ? `${line.slice(0, 119)}…` : line));
  return lines.length ? lines.join("\n") : null;
}

function completePendingPhaseAgents(manifest, phase) {
  let phasePosition = 0;
  for (const agent of manifest.swarm?.agents ?? []) {
    if (agent.phase !== phase) continue;
    const agentIndex = phasePosition;
    phasePosition += 1;
    if (agent.completed_at) continue;
    applyAgentComplete(manifest, {
      phase,
      subagentId: agent.subagent_id ?? null,
      agentIndex,
      finalSummary: agent.last_progress ?? agent.summary ?? null,
    });
  }
}

function createPhaseSwarmSnapshot(manifest, phase, agents, expectedSpecs) {
  return {
    agents,
    phase_metrics: manifest.phase_metrics?.[phase] ?? null,
    target_agents: manifest.swarm?.target_agents?.[phase] ?? null,
    scope_score: manifest.complexity?.scope_score ?? null,
    change_score: manifest.complexity?.change_score ?? null,
    wave_count: manifest.swarm?.wave_plan?.[phase]?.waves?.length ?? null,
    expected_agent_specs: expectedSpecs ?? [],
  };
}

export function archivePhaseSwarm(manifest, phase) {
  completePendingPhaseAgents(manifest, phase);
  const agents = (manifest.swarm?.agents ?? []).filter((agent) => agent.phase === phase);
  const expectedSpecs = manifest.swarm?.expected_specs_phase === phase
    ? manifest.swarm?.expected_agent_specs ?? []
    : [];
  if (!agents.length && !manifest.phase_metrics?.[phase] && !expectedSpecs?.length) return;
  manifest.swarm_history = manifest.swarm_history ?? {};
  manifest.swarm_history[phase] =
    createPhaseSwarmSnapshot(manifest, phase, agents, expectedSpecs);
}

function aggregatePhaseMetrics(phaseMetrics) {
  let phaseDurationMs = 0;
  for (const [phase, metrics] of Object.entries(phaseMetrics)) {
    if (phase.endsWith("_swarm_target")) continue;
    if (metrics?.duration_ms != null) phaseDurationMs += metrics.duration_ms;
  }
  return { phaseDurationMs };
}

function latestAttemptAgents(manifest) {
  const phases = new Set([
    ...Object.keys(manifest.swarm_history ?? {}),
    ...(manifest.swarm?.agents ?? []).map((agent) => agent.phase),
  ]);
  const agents = [];
  for (const phase of phases) {
    if (!phase) continue;
    const candidates = [
      ...(manifest.swarm_history?.[phase]?.agents ?? []),
      ...(manifest.swarm?.agents ?? []).filter((agent) => agent.phase === phase),
    ];
    const latestBySlot = new Map();
    for (const [index, agent] of filterAgentsToLatestPhaseAttempt(
      candidates,
      manifest.log,
      phase,
    ).entries()) {
      const slot = Number.isInteger(Number(agent.index)) && Number(agent.index) > 0
        ? Number(agent.index)
        : `position:${index}`;
      const prior = latestBySlot.get(slot);
      const priorAt = Date.parse(prior?.started_at ?? prior?.at ?? "");
      const nextAt = Date.parse(agent.started_at ?? agent.at ?? "");
      if (!prior || !Number.isFinite(priorAt) ||
        (Number.isFinite(nextAt) && nextAt >= priorAt)) {
        latestBySlot.set(slot, agent);
      }
    }
    agents.push(...latestBySlot.values());
  }
  return agents;
}

export function aggregateRunMetrics(manifest) {
  const phaseMetrics = manifest.phase_metrics ?? {};
  const { phaseDurationMs } = aggregatePhaseMetrics(phaseMetrics);
  const completedAt = manifest.completed_at ?? manifest.updated_at ?? isoNow();
  const conversationSource =
    manifest.metrics?.token_source ?? manifest.metrics?.context_source;
  const conversationTokens = ["cursor_hook", "cursor_cli_usage", "conversation"].includes(
    conversationSource,
  ) ? manifest.metrics?.conversation_tokens ?? null : null;
  const meteredAgents = latestAttemptAgents(manifest).filter(
    (agent) =>
      agent.token_source !== "unavailable" &&
      typeof agent.tokens === "number" &&
      Number.isFinite(agent.tokens) &&
      agent.tokens >= 0,
  );
  const contexts = meteredAgents
    .map((agent) => agent.context)
    .filter(
      (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
    );
  const agentTokens = meteredAgents.reduce((sum, agent) => sum + agent.tokens, 0);
  const totalTokens = meteredAgents.length ? agentTokens : conversationTokens;
  const tokenSource = meteredAgents.length
    ? "agent_aggregate"
    : conversationTokens != null
      ? (conversationSource ?? "conversation")
      : "unavailable";
  return {
    completed_at: completedAt,
    duration_ms: durationMsBetween(manifest.created_at, completedAt) ?? phaseDurationMs,
    total_tokens: totalTokens,
    conversation_tokens: conversationTokens,
    metered_agent_count: meteredAgents.length,
    avg_context_percent: contexts.length
      ? contexts.reduce((sum, value) => sum + value, 0) / contexts.length
      : null,
    context_usage_percent: contexts.length
      ? contexts.reduce((sum, value) => sum + value, 0) / contexts.length
      : null,
    context_window_size: manifest.metrics?.context_window_size ?? null,
    context_source: manifest.metrics?.context_source ?? null,
    token_source: tokenSource,
    phase_count: Object.keys(phaseMetrics).filter(
      (phase) => !phase.endsWith("_swarm_target"),
    ).length,
  };
}

export function finalizeRunMetrics(manifest, options = {}) {
  if (!manifest.completed_at) manifest.completed_at = options.completedAt ?? isoNow();
  if (manifest.metrics?.conversation_tokens == null || options.forceTranscript) {
    const metrics = resolveConversationContextMetrics(
      { conversation_id: manifest.conversation_id },
      options.workspaceRoot ?? process.env.AAAC_WORKSPACE_ROOT ?? REPO_ROOT,
    );
    if (metrics) applyConversationContextMetrics(manifest, metrics, "finalize");
  }

  manifest.metrics = aggregateRunMetrics(manifest);
  return { ok: true, metrics: manifest.metrics };
}
