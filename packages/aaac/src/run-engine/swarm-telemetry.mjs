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
  return estimateUsageFromCharCount(totalChars);
}

export function estimateUsageFromCharCount(totalChars = 0) {
  const tokens = Math.max(1, Math.round(Number(totalChars) / 4));
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

export function findAgentArrayIndexBySubagentId(manifest, phase, subagentId) {
  if (!subagentId) return null;
  const agents = manifest.swarm?.agents ?? [];
  for (let i = 0; i < agents.length; i++) {
    if (agents[i].phase === phase && agents[i].subagent_id === subagentId) return i;
  }
  return null;
}

/** Last agent in phase without completed_at, else last agent in phase. Returns array index. */
export function findAgentIndexToComplete(manifest, phase) {
  const agents = manifest.swarm?.agents ?? [];
  for (let i = agents.length - 1; i >= 0; i -= 1) {
    if (agents[i].phase === phase && !agents[i].completed_at) return i;
  }
  for (let i = agents.length - 1; i >= 0; i -= 1) {
    if (agents[i].phase === phase) return i;
  }
  return null;
}

/**
 * Map a 0-based slot within a phase swarm to manifest.swarm.agents array index.
 * phase-runner passes phase-local agentIndex, not a global array subscript.
 */
export function findAgentArrayIndexByPhasePosition(manifest, phase, positionInPhase = 0) {
  const agents = manifest.swarm?.agents ?? [];
  const inPhase = agents
    .map((agent, arrayIndex) => ({ agent, arrayIndex }))
    .filter(({ agent }) => agent.phase === phase);

  const incomplete = inPhase.filter(({ agent }) => !agent.completed_at);
  const pool = incomplete.length > 0 ? incomplete : inPhase;
  if (positionInPhase >= 0 && positionInPhase < pool.length) {
    return pool[positionInPhase].arrayIndex;
  }
  return findAgentIndexToComplete(manifest, phase);
}

function truncateText(value, max = 120) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function basenamePath(value) {
  const parts = String(value ?? "").split(/[/\\]/);
  return parts[parts.length - 1] || String(value ?? "");
}

/** Layman one-line summary from a Cursor postToolUse hook payload. */
export function formatHookProgressSummary(hook = {}) {
  const tool = hook.tool_name ?? hook.toolName ?? "";
  const input = hook.tool_input ?? hook.toolInput ?? hook.arguments ?? {};
  const step =
    input.current_step ??
    input.currentStep ??
    input.final_summary ??
    input.finalSummary;
  if (typeof step === "string" && step.trim()) {
    return truncateText(step);
  }

  const path = input.path ?? input.file_path ?? input.filePath;
  const pattern = input.pattern ?? input.query ?? input.search_term ?? input.glob_pattern;
  const command = input.command;
  const description = input.description ?? hook.description;

  switch (tool) {
    case "Read":
      return path ? `Reading ${basenamePath(path)}` : "Reading a file";
    case "Grep":
      return pattern ? `Searching for "${truncateText(pattern, 60)}"` : "Searching the codebase";
    case "SemanticSearch":
      return pattern ? `Searching: ${truncateText(pattern, 60)}` : "Searching the codebase";
    case "Glob":
      return pattern ? `Finding files: ${truncateText(pattern, 60)}` : "Finding files";
    case "Write":
    case "StrReplace":
    case "Delete":
      return path ? `Editing ${basenamePath(path)}` : "Editing a file";
    case "Shell":
      return command ? `Running: ${truncateText(command, 60)}` : "Running a command";
    case "Task":
      return description ? truncateText(description) : "Running a sub-agent";
    default:
      if (description) return truncateText(description);
      if (tool) return `Using ${tool}`;
      return null;
  }
}

export function formatAgentSpawnDetail(phase, launchIndex, description) {
  const trimmed = String(description ?? "").trim();
  if (trimmed) return trimmed;
  return `${phase} agent ${launchIndex} started`;
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

  let arrayIndex =
    opts.agentIndex != null && opts.agentIndex >= 0
      ? findAgentArrayIndexByPhasePosition(manifest, phase, opts.agentIndex)
      : findAgentIndexToComplete(manifest, phase);

  const priorEntry =
    arrayIndex != null && arrayIndex >= 0 ? manifest.swarm.agents[arrayIndex] : null;
  const startedAt = priorEntry?.started_at ?? priorEntry?.at ?? completedAt;
  const durationMs = durationMsBetween(startedAt, completedAt);

  const phaseSlot =
    opts.agentIndex != null && opts.agentIndex >= 0
      ? opts.agentIndex + 1
      : (priorEntry?.index ??
        manifest.swarm.agents.filter((agent) => agent.phase === phase).length + 1);

  const agentEntry = {
    ...(priorEntry ?? {
      index: phaseSlot,
      phase,
      description: `${phase} agent ${phaseSlot}`,
    }),
    phase,
    tokens: tokens ?? priorEntry?.tokens ?? null,
    context: context ?? priorEntry?.context ?? null,
    cursor_run_id: opts.cursorRunId ?? priorEntry?.cursor_run_id ?? null,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
  };

  if (arrayIndex != null && arrayIndex >= 0) {
    manifest.swarm.agents[arrayIndex] = agentEntry;
  } else {
    manifest.swarm.agents.push(agentEntry);
    arrayIndex = manifest.swarm.agents.length - 1;
  }

  manifest.phase_metrics = manifest.phase_metrics ?? {};
  const priorMetrics = manifest.phase_metrics[phase] ?? {};
  manifest.phase_metrics[phase] = {
    ...priorMetrics,
    tokens: (priorMetrics.tokens ?? 0) + (tokens ?? 0),
    context: Math.max(priorMetrics.context ?? 0, context ?? 0),
  };

  const detailParts = [
    `index=${phaseSlot}`,
    `agent_index=${phaseSlot}`,
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

  return { agentIndex: arrayIndex, phaseSlot, agentEntry, tokens, context, durationMs };
}

export function archivePhaseSwarm(manifest, phase) {
  const agents = (manifest.swarm?.agents ?? []).filter((a) => a.phase === phase);
  const expectedSpecs = manifest.swarm?.expected_agent_specs ?? null;
  if (!agents.length && !manifest.phase_metrics?.[phase] && !expectedSpecs?.length) return;
  manifest.swarm_history = manifest.swarm_history ?? {};
  manifest.swarm_history[phase] = {
    agents,
    phase_metrics: manifest.phase_metrics?.[phase] ?? null,
    ...(expectedSpecs?.length ? { expected_agent_specs: expectedSpecs } : {}),
  };
}

export function maxAgentContextFromManifest(manifest) {
  let max = null;
  const consume = (context) => {
    if (context == null || context < 0) return;
    max = max == null ? context : Math.max(max, context);
  };
  for (const agent of manifest.swarm?.agents ?? []) consume(agent.context);
  for (const snapshot of Object.values(manifest.swarm_history ?? {})) {
    for (const agent of snapshot.agents ?? []) consume(agent.context);
  }
  return max;
}

export function resolveRunContextPercent(manifest) {
  const conversation = manifest.metrics?.context_usage_percent ?? null;
  const agentMax = maxAgentContextFromManifest(manifest);
  if (conversation != null && agentMax != null) return Math.max(conversation, agentMax);
  return conversation ?? agentMax;
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
  const conversationTokens = manifest.metrics?.conversation_tokens ?? null;
  return {
    completed_at: completedAt,
    duration_ms:
      durationMsBetween(manifest.created_at, completedAt) ?? phaseDurationMs,
    total_tokens: conversationTokens ?? (totalTokens || null),
    conversation_tokens: conversationTokens,
    context_usage_percent: resolveRunContextPercent(manifest),
    context_window_size: manifest.metrics?.context_window_size ?? null,
    context_source: manifest.metrics?.context_source ?? null,
    phase_count: Object.keys(phaseMetrics).length,
  };
}
