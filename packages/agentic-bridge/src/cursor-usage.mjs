/**
 * Exact Cursor usage metering.
 * Context % = (input + output) / model_context_window * 100 (SSOT window).
 * Cache tokens are accumulated separately and never mixed into context %.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_USAGE_EVENT_TYPES = new Set(["token-usage", "token_usage"]);
const TOKEN_COMPONENT_FIELDS = [
  ["inputTokens", "input_tokens"],
  ["outputTokens", "output_tokens"],
  ["cacheReadTokens", "cache_read_tokens"],
  ["cacheWriteTokens", "cache_write_tokens"],
];

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function exactNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readNumber(payload, camelKey, snakeKey) {
  return exactNonNegativeNumber(payload?.[camelKey] ?? payload?.[snakeKey]);
}

function resolveUsagePayload(event) {
  if (isRecord(event?.usage)) return event.usage;
  if (!TOKEN_USAGE_EVENT_TYPES.has(event?.type)) return null;
  if (isRecord(event.payload)) return event.payload;
  return isRecord(event) ? event : null;
}

function readComponents(payload) {
  return {
    input: readNumber(payload, "inputTokens", "input_tokens") ?? 0,
    output: readNumber(payload, "outputTokens", "output_tokens") ?? 0,
    cacheRead: readNumber(payload, "cacheReadTokens", "cache_read_tokens") ?? 0,
    cacheWrite: readNumber(payload, "cacheWriteTokens", "cache_write_tokens") ?? 0,
  };
}

function exactTokenTotal(payload) {
  const explicit = readNumber(payload, "totalTokens", "total_tokens");
  if (explicit != null) return explicit;
  const components = TOKEN_COMPONENT_FIELDS
    .map(([camelKey, snakeKey]) => readNumber(payload, camelKey, snakeKey))
    .filter((value) => value != null);
  return components.length > 0
    ? components.reduce((total, value) => total + value, 0)
    : null;
}

function readWindowFromYaml(model) {
  const candidates = [
    path.resolve(__dirname, "../../../.cursor/aaac/model-pricing.yaml"),
    path.resolve(
      __dirname,
      "../../aaac/templates/cursor/aaac/model-pricing.yaml",
    ),
  ];
  const key = String(model || "")
    .trim()
    .toLowerCase();
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const aliasMatch = text.match(
      new RegExp(
        `^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*([a-z0-9._-]+)\\s*$`,
        "m",
      ),
    );
    const resolved = aliasMatch?.[1] || key;
    const block = text.match(
      new RegExp(
        `^  ${resolved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9]|\\n[a-z]|$)`,
        "m",
      ),
    );
    if (!block) continue;
    const win = block[1].match(/context_window:\s*(\d+)/);
    if (win) return Number(win[1]);
  }
  return null;
}

export function resolveModelContextWindow(model, envelope = null) {
  const payloadWin = readNumber(
    envelope,
    "contextWindowSize",
    "context_window_size",
  );
  if (payloadWin != null) return payloadWin;
  if (
    Number.isFinite(Number(process.env.CURSOR_MODEL_CONTEXT)) &&
    Number(process.env.CURSOR_MODEL_CONTEXT) > 0
  ) {
    return Number(process.env.CURSOR_MODEL_CONTEXT);
  }
  try {
    const require = createRequire(import.meta.url);
    // Prefer package export when linked
    const mod = require("@ludecker/aaac/run-engine/estimate-token-cost");
    if (typeof mod.getModelContextWindow === "function") {
      const w = mod.getModelContextWindow(model);
      if (w) return w;
    }
  } catch {
    // fall through to yaml
  }
  const fromYaml = readWindowFromYaml(model);
  if (fromYaml) return fromYaml;
  if (!model) return null;
  if (String(model).toLowerCase().includes("1m")) return 1_000_000;
  return 200_000;
}

export function computeUsageContextPercent({
  input = 0,
  output = 0,
  model = null,
  contextWindow = null,
  envelope = null,
} = {}) {
  const window =
    (typeof contextWindow === "number" && contextWindow > 0
      ? contextWindow
      : null) ?? resolveModelContextWindow(model, envelope);
  if (window == null || window <= 0) return null;
  const inTok = Number(input) || 0;
  const outTok = Number(output) || 0;
  return ((inTok + outTok) / window) * 100;
}

function usageRequestId(event, payload) {
  const value =
    event?.request_id ??
    event?.requestId ??
    payload?.request_id ??
    payload?.requestId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseCursorUsageEvent(event, { model = null } = {}) {
  if (!isRecord(event)) return null;
  const payload = resolveUsagePayload(event);
  if (!payload) return null;
  const tokens = exactTokenTotal(payload);
  if (tokens == null) return null;
  const components = readComponents(payload);
  const modelSlug =
    model ||
    event?.model ||
    payload?.model ||
    process.env.CURSOR_MODEL ||
    null;
  const contextWindow = resolveModelContextWindow(modelSlug, event);
  return {
    kind: "usage",
    tokens,
    components,
    context: computeUsageContextPercent({
      input: components.input,
      output: components.output,
      model: modelSlug,
      contextWindow,
      envelope: event,
    }),
    contextWindow,
    requestId: usageRequestId(event, payload),
  };
}

function usageIdentity(usage) {
  return usage.requestId;
}

export function createCursorUsageAccumulator() {
  return {
    tokens: 0,
    components: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    context: null,
    contextSamples: [],
    requestIds: [],
    seen: new Set(),
    available: false,
  };
}

export function accumulateCursorUsage(state, usage) {
  const identity = usageIdentity(usage);
  if (identity && state.seen.has(identity)) return false;
  if (identity) state.seen.add(identity);
  state.available = true;
  state.tokens += usage.tokens;
  if (usage.components) {
    state.components.input += usage.components.input ?? 0;
    state.components.output += usage.components.output ?? 0;
    state.components.cacheRead += usage.components.cacheRead ?? 0;
    state.components.cacheWrite += usage.components.cacheWrite ?? 0;
  }
  if (usage.context != null) {
    state.contextSamples.push(usage.context);
  }
  const pathCtx = computeUsageContextPercent({
    input: state.components.input,
    output: state.components.output,
    contextWindow: usage.contextWindow,
    model: process.env.CURSOR_MODEL,
  });
  if (pathCtx != null) {
    state.context = pathCtx;
  } else if (usage.context != null) {
    state.context =
      state.context == null
        ? usage.context
        : Math.max(state.context, usage.context);
  }
  if (usage.requestId) state.requestIds.push(usage.requestId);
  return true;
}

export function cursorUsageMetrics(state) {
  if (!state.available) {
    return {
      tokens: null,
      components: null,
      context: null,
      contextMean: null,
      tokenSource: "unavailable",
    };
  }
  const cumulative = computeUsageContextPercent({
    input: state.components.input,
    output: state.components.output,
    model: process.env.CURSOR_MODEL,
  });
  const contextMean =
    cumulative != null
      ? cumulative
      : state.contextSamples.length > 0
        ? state.contextSamples.reduce((a, b) => a + b, 0) /
          state.contextSamples.length
        : state.context;
  return {
    tokens: state.tokens,
    components: { ...state.components },
    context: cumulative ?? state.context,
    contextMean,
    tokenSource: "cursor_cli_usage",
    ...(state.requestIds.length > 0 ? { requestIds: [...state.requestIds] } : {}),
  };
}
