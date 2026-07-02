/**
 * Shared swarm agent telemetry — spawn completion, phase/run rollups.
 */
import { isoNow } from "./lib.mjs";
import { recordLog } from "./log.mjs";

export function parseMetricFromDetail(detail, key) {
  const match = String(detail ?? "").match(new RegExp(`${key}=(\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : null;
}

export function estimateUsageFromText(prompt = "", output = "") {
  const totalChars = String(prompt).length + String(output).length;
  const tokens = Math.max(1, Math.round(totalChars / 4));
  const modelContext = Number(process.env.CURSOR_MODEL_CONTEXT ?? 200_000);
  const context = Math.min(100, Math.round((tokens / modelContext) * 10000) / 100);
  return { tokens, context };
}

export function formatAgentMetricsDetail(metrics) {
  return `tokens=${metrics.tokens} context=${metrics.context.toFixed(2)}`;
}

export function durationMsBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return ms >= 0 ? ms : null;
}

export function findPhaseStartAt(manifest, phase) {
  for (const entry of manifest.log ?? []) {
    if (entry.phase === phase && entry.event === "phase_start") return entry.at;
  }
  return null;
}

export function computePhaseDurationMs(manifest, phase, completedAt = isoNow()) {
  return durationMsBetween(findPhaseStartAt(manifest, phase), completedAt);
}

/** Last agent in phase without completed_at, else last agent in phase. */
export function findAgentArrayIndexBySubagentId(manifest, phase, subagentId) {
  if (!subagentId) return null;
  const agents = manifest.swarm?.agents ?? [];
  for (let i = 0; i < agents.length; i++) {
    if (agents[i].phase === phase && agents[i].subagent_id === subagentId) return i;
  }
  return null;
}

/** Last agent in phase without completed_at, else last agent in phase. */
export function findAgentIndexToComplete(manifest, phase) {
  const agents = manifest.swarm?.agents ?? [];
  for (let i = agents.length - 1; i >= 0; i -= 1) {
    if (agents[i].phase === phase && !agents[i].completed_at) return i;
  }
  for (let i = agents.length - 1; i >= 0; i -= 1) {
    if (agents[i].phase === phase) return i;
  }
  return agents.length > 0 ? agents.length - 1 : null;
}

/**
 * @param {object} manifest
 * @param {{ agentIndex?: number, phase: string, detail?: string, cursorRunId?: string|null, completedAt?: string, tokens?: number|null, context?: number|null }} opts
 */
export function applyAgentComplete(manifest, opts) {
  const phase = opts.phase ?? manifest.phase;
  const completedAt = opts.completedAt ?? isoNow();
  let tokens = opts.tokens ?? parseMetricFromDetail(opts.detail, "tokens");
  let context =
    opts.context ??
    parseMetricFromDetail(opts.detail, "context") ??
    parseMetricFromDetail(opts.detail, "score");

  if (tokens == null && opts.detail) {
    const estimated = estimateUsageFromText("", opts.detail);
    tokens = estimated.tokens;
    context = context ?? estimated.context;
  }

  manifest.swarm = manifest.swarm ?? { task_launches_this_phase: 0, phase, agents: [] };
  manifest.swarm.agents = manifest.swarm.agents ?? [];

  let agentIndex = opts.agentIndex;
  if (agentIndex == null || agentIndex < 0) {
    agentIndex = findAgentIndexToComplete(manifest, phase);
  }

  const priorEntry =
    agentIndex != null && agentIndex >= 0 ? manifest.swarm.agents[agentIndex] : null;
  const startedAt = priorEntry?.started_at ?? priorEntry?.at ?? completedAt;
  const durationMs = durationMsBetween(startedAt, completedAt);

  const agentEntry = {
    ...(priorEntry ?? {
      index: (manifest.swarm.agents.length || 0) + 1,
      phase,
      description: `Agent ${(agentIndex ?? 0) + 1}`,
    }),
    phase,
    tokens: tokens ?? priorEntry?.tokens ?? null,
    context: context ?? priorEntry?.context ?? null,
    cursor_run_id: opts.cursorRunId ?? priorEntry?.cursor_run_id ?? null,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
  };

  if (agentIndex != null && agentIndex >= 0) {
    manifest.swarm.agents[agentIndex] = agentEntry;
  } else {
    manifest.swarm.agents.push(agentEntry);
    agentIndex = manifest.swarm.agents.length - 1;
  }

  manifest.phase_metrics = manifest.phase_metrics ?? {};
  const priorMetrics = manifest.phase_metrics[phase] ?? {};
  manifest.phase_metrics[phase] = {
    ...priorMetrics,
    tokens: (priorMetrics.tokens ?? 0) + (tokens ?? 0),
    context: Math.max(priorMetrics.context ?? 0, context ?? 0),
  };

  const detailParts = [
    `index=${agentIndex + 1}`,
    tokens != null ? `tokens=${tokens}` : null,
    context != null ? `context=${context}` : null,
    durationMs != null ? `duration_ms=${durationMs}` : null,
  ].filter(Boolean);

  recordLog(manifest, {
    event: "agent_complete",
    phase,
    phase_kind: manifest.phase_kind,
    detail: opts.detail ?? detailParts.join(" "),
    level: "debug",
  });

  return { agentIndex, agentEntry, tokens, context, durationMs };
}

export function archivePhaseSwarm(manifest, phase) {
  const agents = (manifest.swarm?.agents ?? []).filter((a) => a.phase === phase);
  if (!agents.length && !manifest.phase_metrics?.[phase]) return;
  manifest.swarm_history = manifest.swarm_history ?? {};
  manifest.swarm_history[phase] = {
    agents,
    phase_metrics: manifest.phase_metrics?.[phase] ?? null,
  };
}

export function aggregateRunMetrics(manifest) {
  const phaseMetrics = manifest.phase_metrics ?? {};
  let totalTokens = 0;
  let phaseDurationMs = 0;
  for (const metrics of Object.values(phaseMetrics)) {
    if (metrics?.tokens != null) totalTokens += metrics.tokens;
    if (metrics?.duration_ms != null) phaseDurationMs += metrics.duration_ms;
  }
  const completedAt = manifest.completed_at ?? manifest.updated_at ?? isoNow();
  return {
    completed_at: completedAt,
    duration_ms:
      durationMsBetween(manifest.created_at, completedAt) ?? phaseDurationMs,
    total_tokens: totalTokens || null,
    phase_count: Object.keys(phaseMetrics).length,
  };
}
