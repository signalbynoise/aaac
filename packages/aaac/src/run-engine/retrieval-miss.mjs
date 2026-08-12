/**
 * Retrieval miss / low-confidence signal — graph miss must not silently
 * escape into Glob/Grep. Index layer expands, repairs, or authorizes fallback.
 */
import fs from "fs";
import path from "path";
import { isoNow, loadRunManifest, runDir, writeJson, readJson } from "./lib.mjs";
import { normalizeRepoPath } from "./evaluate-finding-tools.mjs";
import { loadRepoGraph, verifyRepoGraph } from "./experience/repo-graph.mjs";
import { expandCandidatePaths } from "./experience/repo-index/span-retrieve.mjs";

export const RETRIEVAL_MISS_REASONS = [
  "not_in_focus",
  "envelope_too_thin",
  "stale_claim",
  "symbol_missing",
  "relation_missing",
  "other",
];

const MAX_EXPANDED_PATHS = 8;
const MAX_HINTS = 10;
const HEAL_VERSION = 1;

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

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_./+-]+/)
    .filter((t) => t.length > 1);
}

/**
 * Resolve candidate repo paths for sought terms via sparse overlap + 1-hop expand.
 * Pure over the loaded graph (no embeddings).
 *
 * @param {string[]} soughtTerms
 * @param {{ maxPaths?: number, knownFocus?: string[] }} [opts]
 * @returns {{ paths: string[], by_sought: Record<string, string[]> }}
 */
export function resolvePathsForSought(soughtTerms, opts = {}) {
  const maxPaths = opts.maxPaths ?? MAX_EXPANDED_PATHS;
  const knownFocus = (opts.knownFocus ?? []).map(normalizeRepoPath).filter(Boolean);
  const terms = [...new Set((soughtTerms ?? []).map((t) => String(t).trim()).filter(Boolean))];
  if (!terms.length) {
    return { paths: [], by_sought: {} };
  }

  let graph;
  try {
    graph = loadRepoGraph();
    verifyRepoGraph(graph);
  } catch {
    return { paths: [], by_sought: {} };
  }

  const active = Object.fromEntries(
    Object.entries(graph.nodes ?? {}).filter(([, n]) => n.valid !== false && n.path),
  );
  const bySought = {};
  const scored = new Map();

  for (const sought of terms) {
    const qTokens = tokenize(sought);
    const hits = [];
    for (const node of Object.values(active)) {
      const hay = [
        node.path,
        node.summary,
        node.api,
        node.claim,
        node.trigger,
        ...(node.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      let score = 0;
      for (const t of qTokens) {
        if (hay.includes(t)) score += 1;
        const base = String(node.path).split("/").pop()?.toLowerCase() ?? "";
        if (base.includes(t)) score += 2;
      }
      if (score > 0) hits.push({ path: normalizeRepoPath(node.path), score });
    }
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, maxPaths).map((h) => h.path);
    bySought[sought] = top;
    for (const p of top) {
      scored.set(p, (scored.get(p) ?? 0) + 1);
    }
  }

  let seedPaths = [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);

  // Prefer paths not already in focus when expanding
  const known = new Set(knownFocus);
  seedPaths = [
    ...seedPaths.filter((p) => !known.has(p)),
    ...seedPaths.filter((p) => known.has(p)),
  ].slice(0, maxPaths);

  const expanded = expandCandidatePaths(graph, seedPaths.length ? seedPaths : knownFocus, {
    neighborCap: maxPaths,
  });
  const newOnly = expanded.filter((p) => p && !known.has(normalizeRepoPath(p)));
  const resolved = [...new Set([...seedPaths, ...newOnly.map(normalizeRepoPath)])]
    .filter(Boolean)
    .slice(0, maxPaths);

  return { paths: resolved, by_sought: bySought };
}

function loadHeal(artifactsDir) {
  return readJson(path.join(artifactsDir, "retrieval_heal.json"), {
    version: HEAL_VERSION,
    sought_terms: [],
    reasons: [],
    resolved_paths: [],
    failed_sought: [],
    miss_count: 0,
    action: "noop",
  });
}

/**
 * Process recorded misses: expand focus via sought → retrieval_heal.json,
 * or deliberately authorize Grep when expand fails / repeats.
 *
 * @param {string} runId
 * @param {{ authorize?: boolean, maxPaths?: number }} [opts]
 */
export function processRetrievalMisses(runId, opts = {}) {
  const artifactsDir = path.join(runDir(runId), "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  const storePath = path.join(artifactsDir, "retrieval_misses.json");
  const store = readJson(storePath, { version: 1, misses: [] });
  const misses = Array.isArray(store.misses) ? store.misses : [];
  const unprocessed = misses.filter((m) => !m.processed_at);
  if (unprocessed.length === 0) {
    return { ok: true, processed: 0, action: "noop" };
  }

  const soughtTerms = [
    ...new Set(unprocessed.map((m) => String(m.sought ?? "").trim()).filter(Boolean)),
  ];
  const reasons = [
    ...new Set(unprocessed.map((m) => String(m.reason ?? "other")).filter(Boolean)),
  ];

  const pcPath = path.join(artifactsDir, "phase_context.json");
  let knownFocus = [];
  let priorHints = [];
  if (fs.existsSync(pcPath)) {
    try {
      const pc = JSON.parse(fs.readFileSync(pcPath, "utf8"));
      knownFocus = (pc.experience?.repo_memory?.focus_paths ?? []).map(normalizeRepoPath);
      priorHints = Array.isArray(pc.retrieval_hints) ? pc.retrieval_hints : [];
    } catch {
      // ignore
    }
  }

  const priorHeal = loadHeal(artifactsDir);
  const priorFailed = new Set(
    (priorHeal.failed_sought ?? []).map((s) => String(s).toLowerCase()),
  );
  const repeatFailed = soughtTerms.some((s) => priorFailed.has(s.toLowerCase()));

  const { paths: resolvedPaths, by_sought: bySought } = resolvePathsForSought(
    soughtTerms,
    { maxPaths: opts.maxPaths ?? MAX_EXPANDED_PATHS, knownFocus },
  );

  const now = isoNow();
  for (const m of unprocessed) {
    m.processed_at = now;
  }
  store.updated_at = now;
  writeJson(storePath, store);

  const envAuth = /^(1|true|yes)$/i.test(
    String(process.env.AAAC_AUTHORIZE_FALLBACK ?? ""),
  );
  const expandEmpty = resolvedPaths.length === 0;
  const shouldAuthorize =
    opts.authorize === true || envAuth || expandEmpty || repeatFailed;

  const action = shouldAuthorize
    ? "authorize_fallback"
    : resolvedPaths.length
      ? "expand"
      : "expand_hints";

  const heal = {
    version: HEAL_VERSION,
    sought_terms: soughtTerms,
    reasons,
    resolved_paths: resolvedPaths,
    by_sought: bySought,
    failed_sought: shouldAuthorize
      ? [...new Set([...(priorHeal.failed_sought ?? []), ...soughtTerms])]
      : priorHeal.failed_sought ?? [],
    miss_count: unprocessed.length,
    action,
    prepared_at: now,
    consumed_at: null,
  };
  writeJson(path.join(artifactsDir, "retrieval_heal.json"), heal);

  // Soft-write hints onto phase_context for prepare to pick up
  if (fs.existsSync(pcPath)) {
    try {
      const pc = JSON.parse(fs.readFileSync(pcPath, "utf8"));
      const hints = [...priorHints];
      for (const m of unprocessed) {
        hints.push({
          sought: m.sought,
          reason: m.reason,
          at: now,
          resolved_paths: bySought[m.sought] ?? resolvedPaths,
        });
      }
      pc.retrieval_hints = hints.slice(-MAX_HINTS);
      writeJson(pcPath, pc);
    } catch {
      // ignore
    }
  }

  let fallback = null;
  if (shouldAuthorize) {
    try {
      fallback = authorizeFallback(runId, {
        paths: knownFocus.slice(0, 16),
        tools: ["Grep"],
        max_searches: 2,
        from_miss: unprocessed[unprocessed.length - 1] ?? null,
      });
    } catch {
      // phase_context may be missing on early runs
    }
  }

  return {
    ok: true,
    processed: unprocessed.length,
    action,
    resolved_paths: resolvedPaths,
    sought_terms: soughtTerms,
    fallback,
    heal,
  };
}
