/**
 * Conversation-level context metrics — align with Cursor Context Usage panel.
 *
 * SSOT for run chrome only (`manifest.metrics.conversation_*` / context_usage_percent).
 * Never gates, suppresses, or invents per-agent meters — those seal via applyAgentComplete.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { recordLog } from "./log.mjs";

const DEFAULT_STATIC_OVERHEAD_TOKENS = 31_000;
const DEFAULT_CONTEXT_WINDOW = 200_000;
/** JSONL byte/4 under-counts vs Cursor conversation tokens (tool I/O in context, not full transcript). */
const DEFAULT_TRANSCRIPT_TOKEN_MULTIPLIER = 1.9;

function asPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {number} tokens @param {number} windowSize */
export function contextPercentFromTokens(tokens, windowSize) {
  if (!Number.isFinite(tokens) || !Number.isFinite(windowSize) || windowSize <= 0) return null;
  return Math.min(100, Math.round((tokens / windowSize) * 10000) / 100);
}

/**
 * Cursor docs specify 0–100; some payloads send utilization as a 0–1 fraction.
 * @param {number} percent
 */
export function normalizeHookContextPercent(percent) {
  if (percent == null || !Number.isFinite(percent) || percent < 0) return null;
  if (percent > 0 && percent <= 1) {
    return Math.min(100, Math.round(percent * 10000) / 100);
  }
  return Math.min(100, percent);
}

/** @param {object} hook */
export function resolveContextWindowSize(hook = {}) {
  const direct =
    asPositiveNumber(hook.context_window_size) ??
    asPositiveNumber(hook.contextWindowSize);
  if (direct) return direct;

  for (const param of hook.model_params ?? []) {
    if (param?.id !== "context") continue;
    const raw = String(param.value ?? "").trim().toLowerCase();
    if (raw === "1m") return 1_000_000;
    if (raw.endsWith("k")) {
      const n = Number(raw.slice(0, -1));
      if (Number.isFinite(n) && n > 0) return n * 1_000;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const env = Number(process.env.CURSOR_MODEL_CONTEXT);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_CONTEXT_WINDOW;
}

/** @param {object} hook */
export function extractConversationContextFromHook(hook = {}) {
  const tokens =
    asPositiveNumber(hook.context_tokens) ??
    asPositiveNumber(hook.contextTokens) ??
    asPositiveNumber(hook.usage?.context_tokens);
  const percent =
    asPositiveNumber(hook.context_usage_percent) ??
    asPositiveNumber(hook.contextUsagePercent) ??
    asPositiveNumber(hook.usage?.context_usage_percent);
  const windowSize = resolveContextWindowSize(hook);

  if (tokens != null || percent != null) {
    const normalizedPercent =
      percent != null ? normalizeHookContextPercent(percent) : null;
    const resolvedTokens =
      tokens ??
      (normalizedPercent != null
        ? Math.round((normalizedPercent / 100) * windowSize)
        : null);
    const resolvedPercent =
      resolvedTokens != null
        ? contextPercentFromTokens(resolvedTokens, windowSize)
        : normalizedPercent;
    return {
      conversation_tokens: resolvedTokens,
      context_usage_percent: resolvedPercent,
      context_window_size: windowSize,
      source: "cursor_hook",
    };
  }

  return null;
}

function staticContextOverheadTokens() {
  const env = Number(process.env.AAAC_STATIC_CONTEXT_TOKENS);
  return Number.isFinite(env) && env >= 0 ? env : DEFAULT_STATIC_OVERHEAD_TOKENS;
}

function sumJsonlBytes(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return 0;
  let total = 0;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        total += fs.statSync(full).size;
      }
    }
  };

  walk(rootDir);
  return total;
}

export function cursorProjectSlug(workspaceRoot) {
  return path.resolve(workspaceRoot).replace(/^\/+/, "").replace(/[/\\]/g, "-");
}

export function resolveTranscriptDir(workspaceRoot, conversationId) {
  if (!workspaceRoot || !conversationId) return null;
  const slug = cursorProjectSlug(workspaceRoot);
  return path.join(
    os.homedir(),
    ".cursor",
    "projects",
    slug,
    "agent-transcripts",
    conversationId,
  );
}

export function resolveTranscriptPathFromHook(hook = {}, workspaceRoot = null) {
  const direct =
    hook.transcript_path ??
    hook.transcriptPath ??
    process.env.CURSOR_TRANSCRIPT_PATH ??
    null;
  if (direct && fs.existsSync(direct)) {
    return fs.statSync(direct).isDirectory() ? direct : path.dirname(direct);
  }

  const conversationId =
    hook.conversation_id ?? hook.conversationId ?? hook.session_id ?? hook.sessionId;
  const root = workspaceRoot ?? process.env.AAAC_WORKSPACE_ROOT ?? process.cwd();
  if (!conversationId) return null;
  const dir = resolveTranscriptDir(root, conversationId);
  return dir && fs.existsSync(dir) ? dir : null;
}

function transcriptTokenMultiplier() {
  const env = Number(process.env.AAAC_TRANSCRIPT_TOKEN_MULTIPLIER);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TRANSCRIPT_TOKEN_MULTIPLIER;
}

/** Estimate conversation context from Cursor transcript JSONL tree + static overhead. */
export function estimateConversationContextFromTranscript(transcriptDir, windowSize) {
  const bytes = sumJsonlBytes(transcriptDir);
  if (bytes <= 0) return null;

  const conversationPortion = Math.max(
    1,
    Math.round((bytes / 4) * transcriptTokenMultiplier()),
  );
  const conversation_tokens = conversationPortion + staticContextOverheadTokens();
  const context_usage_percent = contextPercentFromTokens(conversation_tokens, windowSize);

  return {
    conversation_tokens,
    context_usage_percent,
    context_window_size: windowSize,
    source: "transcript_estimate",
    transcript_bytes: bytes,
  };
}

/**
 * Resolve best available conversation metrics from hook payload and/or transcript.
 * @param {object} hook
 * @param {string} [workspaceRoot]
 */
export function resolveConversationContextMetrics(hook = {}, workspaceRoot = null) {
  const fromHook = extractConversationContextFromHook(hook);
  if (fromHook) return fromHook;

  const windowSize = resolveContextWindowSize(hook);
  const transcriptDir = resolveTranscriptPathFromHook(hook, workspaceRoot);
  return estimateConversationContextFromTranscript(transcriptDir, windowSize);
}

/**
 * Persist conversation context on run manifest (monotonic — never regress tokens/percent).
 * @param {object} manifest
 * @param {object} metrics
 * @param {string} [detailSource]
 */
export function applyConversationContextMetrics(manifest, metrics, detailSource = "context") {
  if (!metrics?.conversation_tokens && !metrics?.context_usage_percent) return false;

  manifest.metrics = manifest.metrics ?? {};
  const prior = manifest.metrics;
  const nextTokens = Math.max(
    prior.conversation_tokens ?? 0,
    metrics.conversation_tokens ?? 0,
  );
  const nextPercent = Math.max(
    prior.context_usage_percent ?? 0,
    metrics.context_usage_percent ?? 0,
  );

  const changed =
    prior.conversation_tokens !== nextTokens ||
    prior.context_usage_percent !== nextPercent ||
    prior.context_window_size !== metrics.context_window_size ||
    prior.context_source !== metrics.source;

  manifest.metrics.conversation_tokens = nextTokens || null;
  manifest.metrics.context_usage_percent = nextPercent || null;
  manifest.metrics.context_window_size = metrics.context_window_size ?? prior.context_window_size ?? null;
  manifest.metrics.context_source = metrics.source ?? prior.context_source ?? null;
  manifest.metrics.context_updated_at = new Date().toISOString();

  if (metrics.source === "cursor_hook") {
    manifest.metrics.total_tokens = nextTokens || manifest.metrics.total_tokens || null;
  }

  recordLog(manifest, {
    event: "conversation_context",
    phase: manifest.phase,
    phase_kind: manifest.phase_kind,
    detail: `${detailSource} tokens=${nextTokens} context=${nextPercent?.toFixed?.(2) ?? nextPercent} source=${metrics.source ?? "unknown"}`,
    level: "debug",
  });

  return changed;
}
