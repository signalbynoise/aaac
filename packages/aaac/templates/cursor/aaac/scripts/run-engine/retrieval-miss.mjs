/**
 * Retrieval miss / low-confidence signal — graph miss must not silently
 * escape into Glob/Grep. Index layer expands, repairs, or authorizes fallback.
 */
import fs from "fs";
import path from "path";
import { isoNow, loadRunManifest, runDir, writeJson, readJson } from "./lib.mjs";
import { normalizeRepoPath } from "./evaluate-finding-tools.mjs";

export const RETRIEVAL_MISS_REASONS = [
  "not_in_focus",
  "envelope_too_thin",
  "stale_claim",
  "symbol_missing",
  "relation_missing",
  "other",
];

/**
 * @param {object} raw
 * @returns {{ ok: true, miss: object } | { ok: false, error: string }}
 */
export function normalizeRetrievalMiss(raw = {}) {
  const sought = String(raw.sought ?? raw.query ?? raw.missing ?? "").trim();
  if (!sought) {
    return { ok: false, error: "retrieval_miss.sought is required" };
  }
  let reason = String(raw.reason ?? "other").trim();
  if (!RETRIEVAL_MISS_REASONS.includes(reason)) reason = "other";
  const confidence = String(raw.confidence ?? "low").toLowerCase();
  const miss = {
    sought,
    reason,
    confidence: ["low", "medium", "high"].includes(confidence)
      ? confidence
      : "low",
    packet_ids_tried: Array.isArray(raw.packet_ids_tried)
      ? raw.packet_ids_tried.map(String).slice(0, 20)
      : [],
    notes: typeof raw.notes === "string" ? raw.notes.slice(0, 2000) : "",
    agent_id: raw.agent_id ?? raw.agentId ?? null,
    phase: raw.phase ?? null,
    recorded_at: isoNow(),
  };
  return { ok: true, miss };
}

/**
 * Append miss to artifacts/retrieval_misses.json
 * @param {string} runId
 * @param {object} rawMiss
 */
export function recordRetrievalMiss(runId, rawMiss) {
  const normalized = normalizeRetrievalMiss(rawMiss);
  if (!normalized.ok) {
    const err = new Error(normalized.error);
    err.code = "INVALID_RETRIEVAL_MISS";
    throw err;
  }
  const artifactsDir = path.join(runDir(runId), "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  const storePath = path.join(artifactsDir, "retrieval_misses.json");
  const store = readJson(storePath, { version: 1, misses: [] });
  store.misses = Array.isArray(store.misses) ? store.misses : [];
  store.misses.push(normalized.miss);
  store.updated_at = isoNow();
  writeJson(storePath, store);
  return { ok: true, path: storePath, miss: normalized.miss };
}

/**
 * Set deliberate authorized_fallback on phase_context.json.
 * @param {string} runId
 * @param {{ paths?: string[], tools?: string[], max_searches?: number, from_miss?: object }} opts
 */
export function authorizeFallback(runId, opts = {}) {
  const pcPath = path.join(runDir(runId), "artifacts", "phase_context.json");
  if (!fs.existsSync(pcPath)) {
    const err = new Error(`phase_context.json missing for ${runId}`);
    err.code = "PHASE_CONTEXT_MISSING";
    throw err;
  }
  const pc = JSON.parse(fs.readFileSync(pcPath, "utf8"));
  const paths = (opts.paths ?? [])
    .map(normalizeRepoPath)
    .filter(Boolean)
    .slice(0, 32);
  const tools = (opts.tools ?? ["Grep"]).map(String);
  pc.authorized_fallback = {
    enabled: true,
    paths,
    tools,
    max_searches: Number.isFinite(Number(opts.max_searches))
      ? Number(opts.max_searches)
      : 2,
    authorized_at: isoNow(),
    from_miss: opts.from_miss ?? null,
  };
  if (!pc.experience) pc.experience = {};
  if (!pc.experience.repo_memory) pc.experience.repo_memory = {};
  if (!pc.experience.repo_memory.meta) pc.experience.repo_memory.meta = {};
  pc.experience.repo_memory.meta.authorized_fallback = pc.authorized_fallback;
  writeJson(pcPath, pc);
  return pc.authorized_fallback;
}

/**
 * Process recorded misses: expand focus via miss.sought into recommended paths,
 * or deliberately authorize a tight Grep fallback when AAAC_AUTHORIZE_FALLBACK=1
 * (or opts.authorize === true).
 *
 * @param {string} runId
 * @param {{ authorize?: boolean }} [opts]
 */
export function processRetrievalMisses(runId, opts = {}) {
  const artifactsDir = path.join(runDir(runId), "artifacts");
  const storePath = path.join(artifactsDir, "retrieval_misses.json");
  const store = readJson(storePath, { version: 1, misses: [] });
  const misses = Array.isArray(store.misses) ? store.misses : [];
  if (misses.length === 0) {
    return { ok: true, processed: 0, action: "noop" };
  }

  const latest = misses[misses.length - 1];
  const pcPath = path.join(artifactsDir, "phase_context.json");
  let expanded = false;

  if (fs.existsSync(pcPath)) {
    const pc = JSON.parse(fs.readFileSync(pcPath, "utf8"));
    const rm = pc.experience?.repo_memory ?? {};
    const focus = Array.isArray(rm.focus_paths) ? [...rm.focus_paths] : [];
    // Soft expand: record sought as a retrieval hint for next prepare/retrieve
    pc.retrieval_hints = pc.retrieval_hints ?? [];
    pc.retrieval_hints.push({
      sought: latest.sought,
      reason: latest.reason,
      at: isoNow(),
    });
    // Keep last 10 hints
    pc.retrieval_hints = pc.retrieval_hints.slice(-10);
    if (!pc.experience) pc.experience = {};
    if (!pc.experience.repo_memory) pc.experience.repo_memory = rm;
    pc.experience.repo_memory.focus_paths = focus;
    writeJson(pcPath, pc);
    expanded = true;
  }

  const envAuth = /^(1|true|yes)$/i.test(
    String(process.env.AAAC_AUTHORIZE_FALLBACK ?? ""),
  );
  const shouldAuthorize = opts.authorize === true || envAuth;
  let fallback = null;
  if (shouldAuthorize) {
    const manifest = loadRunManifest(runId);
    const known = [];
    try {
      const pc = JSON.parse(fs.readFileSync(pcPath, "utf8"));
      const rm = pc.experience?.repo_memory ?? {};
      for (const p of rm.focus_paths ?? []) known.push(p);
    } catch {
      // ignore
    }
    fallback = authorizeFallback(runId, {
      paths: known.slice(0, 16),
      tools: ["Grep"],
      max_searches: 2,
      from_miss: latest,
    });
    return {
      ok: true,
      processed: misses.length,
      action: "authorize_fallback",
      fallback,
      expanded,
      command: manifest?.command ?? null,
    };
  }

  return {
    ok: true,
    processed: misses.length,
    action: expanded ? "expand_hints" : "recorded",
    fallback: null,
  };
}
