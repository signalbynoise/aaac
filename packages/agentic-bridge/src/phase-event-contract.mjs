import {
  filterAgentsToLatestPhaseAttempt,
  latestPhaseAttemptStartAt,
  validateCurrentStep,
  validateFinalSummary,
  validateInitialSummary,
  validateSealedSummary,
  validateSemanticSummary,
  validateStageSummary,
} from "@ludecker/aaac/run-engine/agent-progress-contract";

export {
  filterAgentsToLatestPhaseAttempt,
  latestPhaseAttemptStartAt,
  validateCurrentStep,
  validateFinalSummary,
  validateInitialSummary,
  validateSealedSummary,
  validateSemanticSummary,
  validateStageSummary,
};

function parseJson(value) {
  if (typeof value !== "string" || !value.trim().startsWith("{")) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function positiveIndex(value) {
  const index = Number(value);
  return Number.isFinite(index) && index > 0 ? index - 1 : null;
}

function parseLegacyAgentIndex(detail) {
  const match = String(detail ?? "").match(/(?:^|\s)agent_index=(\d+)/);
  return match ? positiveIndex(match[1]) : null;
}

function parseDetailNumber(detail, key) {
  const match = String(detail ?? "").match(new RegExp(`(?:^|\\s)${key}=(\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : null;
}

function parseCompletionMetrics(detail) {
  const tokens = parseDetailNumber(detail, "tokens");
  const context = parseDetailNumber(detail, "context");
  const inputTokens = parseDetailNumber(detail, "input");
  const outputTokens = parseDetailNumber(detail, "output");
  const cacheReadTokens = parseDetailNumber(detail, "cache_read");
  const cacheWriteTokens = parseDetailNumber(detail, "cache_write");
  const sourceMatch = String(detail ?? "").match(/(?:^|\s)token_source=([\w-]+)/);
  if (
    tokens == null &&
    context == null &&
    inputTokens == null &&
    outputTokens == null &&
    !sourceMatch
  ) {
    return null;
  }
  return {
    tokens,
    context,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    tokenSource: sourceMatch?.[1] ?? (tokens != null ? "cursor_hook" : "unavailable"),
  };
}

const TOKEN_SOURCES = new Set([
  "cursor_hook",
  "cursor_cli_usage",
  "agent_aggregate",
  "phase_aggregate",
  "conversation",
  "legacy_meter",
  "unavailable",
]);

export function normalizeTokenSource(value) {
  if (typeof value !== "string") return null;
  const source = value.trim();
  return TOKEN_SOURCES.has(source) ? source : null;
}

function componentFromMetrics(value, camelKey, snakeKey, nestedKey) {
  const numberOrNull = (raw) => {
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
  };
  return (
    numberOrNull(value?.[camelKey]) ??
    numberOrNull(value?.[snakeKey]) ??
    numberOrNull(value?.components?.[nestedKey])
  );
}

function normalizeMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const numberOrNull = (raw) => {
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
  };
  const tokenSource = normalizeTokenSource(value.tokenSource ?? value.token_source);
  const requestIds = value.requestIds ?? value.request_ids;
  const unavailable = tokenSource === "unavailable";
  const inputTokens = unavailable
    ? null
    : componentFromMetrics(value, "inputTokens", "input_tokens", "input");
  const outputTokens = unavailable
    ? null
    : componentFromMetrics(value, "outputTokens", "output_tokens", "output");
  const cacheReadTokens = unavailable
    ? null
    : componentFromMetrics(value, "cacheReadTokens", "cache_read_tokens", "cacheRead");
  const cacheWriteTokens = unavailable
    ? null
    : componentFromMetrics(value, "cacheWriteTokens", "cache_write_tokens", "cacheWrite");
  const metrics = {
    tokens: unavailable ? null : numberOrNull(value.tokens),
    context: unavailable ? null : numberOrNull(value.context),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
  if (tokenSource) {
    metrics.tokenSource = tokenSource;
  }
  if (Array.isArray(requestIds)) {
    metrics.requestIds = requestIds.filter(
      (requestId) => typeof requestId === "string" && requestId.trim(),
    );
  }
  return metrics;
}

function normalizeAgentIndex(raw, payload, fallbackAgentIndex) {
  if (Number.isFinite(Number(raw.agentIndex))) return Number(raw.agentIndex);
  return (
    positiveIndex(payload?.agent_index ?? payload?.index ?? payload?.count) ??
    parseLegacyAgentIndex(raw.detail) ??
    fallbackAgentIndex ??
    0
  );
}

function normalizeStartedEvent(base, raw, payload) {
  const initialSummary = validateInitialSummary(
    raw.initialSummary ?? raw.initial_summary ?? payload?.initial_summary,
  );
  return {
    ...base,
    ...(initialSummary ? { initialSummary, detail: initialSummary } : {}),
  };
}

function normalizeProgressEvent(base, raw, payload) {
  const semanticSummary = validateCurrentStep(
    raw.semanticSummary ?? raw.semantic_summary ?? payload?.semantic_summary,
  );
  return semanticSummary
    ? { ...base, semanticSummary, detail: semanticSummary }
    : base;
}

function normalizeCompletedEvent(base, raw, payload) {
  const finalSummary = validateSealedSummary(
    raw.finalSummary ?? raw.final_summary ?? payload?.final_summary,
  );
  const metrics = normalizeMetrics(raw.metrics ?? payload?.metrics);
  return {
    ...base,
    ...(finalSummary ? { finalSummary, detail: finalSummary } : {}),
    ...(typeof (raw.cursorRunId ?? raw.cursor_run_id) === "string"
      ? { cursorRunId: raw.cursorRunId ?? raw.cursor_run_id }
      : {}),
    ...(metrics ? { metrics } : {}),
  };
}

/**
 * Canonical live/replay boundary. Technical detail remains available to diagnostics
 * but cannot become semantic card narrative. The renderer-safe AAAC contract owns
 * semantic validation and this bridge applies it at every transport boundary.
 */
export function normalizePhaseEvent(raw, fallbackAgentIndex = null) {
  if (!raw || typeof raw !== "object") return null;
  const runId = typeof raw.runId === "string" ? raw.runId : null;
  const phase = typeof raw.phase === "string" ? raw.phase : null;
  const type = typeof raw.type === "string" ? raw.type : null;
  if (!runId || !phase || !["started", "progress", "completed"].includes(type)) return null;

  const payload = parseJson(raw.detail);
  const agentIndex = normalizeAgentIndex(raw, payload, fallbackAgentIndex);
  const base = { runId, phase, type, agentIndex };
  if (type === "started") return normalizeStartedEvent(base, raw, payload);
  if (type === "progress") return normalizeProgressEvent(base, raw, payload);
  return normalizeCompletedEvent(base, raw, payload);
}

export function logEntryToPhaseEvent(runId, entry, fallbackAgentIndex = null) {
  if (!entry?.phase || !entry?.event) return null;
  const type =
    entry.event === "agent_spawned" || entry.event === "task_launch"
      ? "started"
      : entry.event === "agent_progress"
        ? "progress"
        : entry.event === "agent_complete"
          ? "completed"
          : null;
  if (!type) return null;
  const metrics = type === "completed" ? parseCompletionMetrics(entry.detail) : null;
  return normalizePhaseEvent(
    { runId, phase: entry.phase, type, detail: entry.detail, metrics },
    fallbackAgentIndex,
  );
}

export function diffLogPhaseEvents(runId, previous = [], next = []) {
  const events = [];
  let lastSpawnIndex = 0;
  for (let index = 0; index < next.length; index += 1) {
    const entry = next[index];
    const payload = parseJson(entry?.detail);
    if (entry?.event === "agent_spawned" || entry?.event === "task_launch") {
      lastSpawnIndex = positiveIndex(payload?.index ?? payload?.count) ?? lastSpawnIndex;
    }
    if (index < previous.length) continue;
    const event = logEntryToPhaseEvent(runId, entry, lastSpawnIndex);
    if (event) events.push(event);
  }
  return events;
}

export function phaseEventToStreamEntry(event, at = new Date().toISOString()) {
  const normalized = normalizePhaseEvent(event);
  if (!normalized) return null;
  return {
    at,
    phase: normalized.phase,
    type: normalized.type,
    agentIndex: normalized.agentIndex,
    ...(normalized.detail ? { detail: normalized.detail } : {}),
    ...(normalized.cursorRunId ? { cursorRunId: normalized.cursorRunId } : {}),
    ...(normalized.metrics ? { metrics: normalized.metrics } : {}),
  };
}

export function persistAgentPhaseEvent(event, persistence) {
  if (event.type === "tool" && event.toolName) {
    return persistence.recordTool(event);
  }
  if (event.type === "progress" && event.semanticSummary) {
    return persistence.recordProgress(event);
  }
  if (event.type === "completed") {
    return persistence.recordComplete(event);
  }
  return null;
}
