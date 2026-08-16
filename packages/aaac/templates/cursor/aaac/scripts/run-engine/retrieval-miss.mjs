/**
 * Retrieval miss / low-confidence signal — graph miss must not silently
 * escape into Glob/Grep. Index layer expands, repairs, or authorizes fallback.
 */
import fs from "fs";
import path from "path";
import { isoNow, loadRunManifest, runDir, writeJson, readJson } from "./lib.mjs";
import { normalizeRepoPath } from "./evaluate-finding-tools.mjs";
import { loadRepoGraph, verifyRepoGraph, resolveWorkspaceRoot } from "./experience/repo-graph.mjs";
import {
  basenameMatchesSought,
  extractPathTokensFromSought,
  pathExistsUnderRoot,
  significantSoughtTokens,
} from "./sought-paths.mjs";
import { CONTEXT_EVENTS } from "./context-taxonomy.mjs";
import {
  normalizeGrantedPaths,
  parseGrantedNotes,
} from "./experience/granted-paths.mjs";

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
const MAX_HEALED_PATHS = 32;

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
  const taxonomyRaw = String(raw.taxonomy ?? "").trim();
  const taxonomy = Object.values(CONTEXT_EVENTS).includes(taxonomyRaw)
    ? taxonomyRaw
    : null;
  const notes = typeof raw.notes === "string" ? raw.notes.slice(0, 2000) : "";
  const granted_paths = [
    ...new Set([
      ...normalizeGrantedPaths(raw.granted_paths),
      ...parseGrantedNotes(notes),
    ]),
  ].slice(0, 8);
  const miss = {
    sought,
    reason,
    confidence: ["low", "medium", "high"].includes(confidence)
      ? confidence
      : "low",
    packet_ids_tried: Array.isArray(raw.packet_ids_tried)
      ? raw.packet_ids_tried.map(String).slice(0, 20)
      : [],
    notes,
    taxonomy,
    granted_paths,
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
 * @param {{ dedupe?: boolean }} [opts]
 */
export function recordRetrievalMiss(runId, rawMiss, opts = {}) {
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
  if (opts.dedupe !== false) {
    const sought = normalized.miss.sought;
    const phase = normalized.miss.phase ?? null;
    const existing = store.misses.find(
      (m) =>
        !m.processed_at &&
        String(m.sought) === sought &&
        (m.phase ?? null) === phase,
    );
    if (existing) {
      const incoming = normalized.miss.granted_paths ?? [];
      if (incoming.length) {
        existing.granted_paths = [
          ...new Set([...(existing.granted_paths ?? []), ...incoming]),
        ].slice(0, 8);
        if (!String(existing.notes ?? "").startsWith("granted:") && normalized.miss.notes) {
          existing.notes = normalized.miss.notes;
        }
        if (!existing.taxonomy && normalized.miss.taxonomy) {
          existing.taxonomy = normalized.miss.taxonomy;
        }
        store.updated_at = isoNow();
        writeJson(storePath, store);
      }
      return { ok: true, path: storePath, miss: existing, deduped: true };
    }
  }
  store.misses.push(normalized.miss);
  store.updated_at = isoNow();
  writeJson(storePath, store);
  return { ok: true, path: storePath, miss: normalized.miss, deduped: false };
}

/**
 * Add a verified path to phase_context.healed_paths so a retry Read is allowed.
 * @param {string} runId
 * @param {string} filePath
 */
export function healPathIntoPhaseContext(runId, filePath) {
  const n = normalizeRepoPath(filePath);
  if (!n) return null;
  const pcPath = path.join(runDir(runId), "artifacts", "phase_context.json");
  if (!fs.existsSync(pcPath)) return null;
  const pc = JSON.parse(fs.readFileSync(pcPath, "utf8"));
  const healed = [
    ...new Set([...(pc.healed_paths ?? []), n].map(normalizeRepoPath).filter(Boolean)),
  ].slice(0, MAX_HEALED_PATHS);
  pc.healed_paths = healed;
  if (!pc.experience) pc.experience = {};
  if (!pc.experience.repo_memory) pc.experience.repo_memory = {};
  pc.experience.repo_memory.healed_paths = healed;
  const focus = pc.experience.repo_memory.focus_paths ?? [];
  if (!focus.includes(n)) {
    pc.experience.repo_memory.focus_paths = [...focus, n].slice(0, 48);
  }
  writeJson(pcPath, pc);
  return { path: n, healed_paths: healed };
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

function workspaceRoot() {
  try {
    return resolveWorkspaceRoot();
  } catch {
    return process.env.AAAC_WORKSPACE_ROOT || process.cwd();
  }
}

function exactPathsForSought(sought) {
  const root = workspaceRoot();
  const tokens = extractPathTokensFromSought(sought);
  const hits = [];
  for (const t of tokens) {
    if (t.includes("/") && pathExistsUnderRoot(t, root)) {
      hits.push(normalizeRepoPath(t));
    }
  }
  return [...new Set(hits)];
}

/**
 * Resolve candidate repo paths for sought terms.
 * Path-on-disk first, then strict basename/symbol match. No lexical spray.
 *
 * @param {string[]} soughtTerms
 * @param {{ maxPaths?: number, knownFocus?: string[], graph?: object|null }} [opts]
 * @returns {{ paths: string[], by_sought: Record<string, string[]>, verified: boolean }}
 */
export function resolvePathsForSought(soughtTerms, opts = {}) {
  const maxPaths = opts.maxPaths ?? MAX_EXPANDED_PATHS;
  const terms = [...new Set((soughtTerms ?? []).map((t) => String(t).trim()).filter(Boolean))];
  if (!terms.length) {
    return { paths: [], by_sought: {}, verified: true };
  }

  let graph = opts.graph ?? null;
  if (!graph) {
    try {
      graph = loadRepoGraph();
      verifyRepoGraph(graph);
    } catch {
      graph = null;
    }
  }

  const active = Object.fromEntries(
    Object.entries(graph?.nodes ?? {}).filter(([, n]) => n.valid !== false && n.path),
  );
  const bySought = {};
  const resolved = [];

  for (const sought of terms) {
    const exact = exactPathsForSought(sought);
    if (exact.length) {
      bySought[sought] = exact.slice(0, maxPaths);
      resolved.push(...bySought[sought]);
      continue;
    }

    const symbolHits = [];
    for (const node of Object.values(active)) {
      const p = normalizeRepoPath(node.path);
      if (!p) continue;
      if (basenameMatchesSought(p, sought)) {
        symbolHits.push(p);
        continue;
      }
      const apiTokens = new Set(
        String(node.api ?? "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length >= 8),
      );
      const soughtTokens = significantSoughtTokens(sought).filter((t) => t.length >= 8);
      if (soughtTokens.some((t) => apiTokens.has(t))) {
        symbolHits.push(p);
      }
    }
    bySought[sought] = [...new Set(symbolHits)].slice(0, 4);
    resolved.push(...bySought[sought]);
  }

  const known = new Set((opts.knownFocus ?? []).map(normalizeRepoPath));
  const paths = [...new Set(resolved.map(normalizeRepoPath).filter(Boolean))]
    .filter((p) => !known.has(p) || true)
    .slice(0, maxPaths);

  return { paths, by_sought: bySought, verified: true };
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

async function retrieveHitsForSought(soughtTerms, runId, bySought) {
  const unresolved = soughtTerms.filter((s) => !(bySought[s] ?? []).length);
  if (!unresolved.length) return bySought;
  try {
    const { retrieveRepoMemory } = await import("./experience/retrieve-repo.mjs");
    const manifest = loadRunManifest(runId) ?? {
      verb: "review",
      object: unresolved[0],
      intent: unresolved.join(" "),
      phase: "discover",
    };
    const packet = await retrieveRepoMemory(
      {
        ...manifest,
        intent: `${manifest.intent ?? ""} ${unresolved.join(" ")}`.trim(),
      },
      {
        emit: false,
        maxNodes: 8,
        retrievalHints: { sought_terms: unresolved },
      },
    );
    const candidates = [
      ...(packet.focus_paths ?? []),
      ...(packet.nodes ?? []).map((n) => n?.path),
    ].filter(Boolean);
    for (const sought of unresolved) {
      const hits = candidates
        .filter(
          (p) =>
            basenameMatchesSought(p, sought) ||
            extractPathTokensFromSought(sought).some(
              (t) => normalizeRepoPath(t) === normalizeRepoPath(p),
            ),
        )
        .slice(0, 4);
      bySought[sought] = hits;
    }
  } catch {
    // retrieve optional in unit tests / empty index
  }
  return bySought;
}

/**
 * Process recorded misses: expand focus via sought → retrieval_heal.json,
 * or deliberately authorize Grep when expand fails / repeats.
 *
 * @param {string} runId
 * @param {{ authorize?: boolean, maxPaths?: number, retrieve?: boolean }} [opts]
 */
export async function processRetrievalMisses(runId, opts = {}) {
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

  let { paths: resolvedPaths, by_sought: bySought } = resolvePathsForSought(
    soughtTerms,
    { maxPaths: opts.maxPaths ?? MAX_EXPANDED_PATHS, knownFocus },
  );

  if (opts.retrieve !== false) {
    bySought = await retrieveHitsForSought(soughtTerms, runId, bySought);
    resolvedPaths = [
      ...new Set(
        Object.values(bySought)
          .flat()
          .map(normalizeRepoPath)
          .filter(Boolean),
      ),
    ].slice(0, opts.maxPaths ?? MAX_EXPANDED_PATHS);
  }

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
    verified: !expandEmpty,
    failed_sought: shouldAuthorize
      ? [...new Set([...(priorHeal.failed_sought ?? []), ...soughtTerms])]
      : priorHeal.failed_sought ?? [],
    miss_count: unprocessed.length,
    action,
    prepared_at: now,
    consumed_at: null,
  };
  writeJson(path.join(artifactsDir, "retrieval_heal.json"), heal);

  if (fs.existsSync(pcPath)) {
    try {
      const pc = JSON.parse(fs.readFileSync(pcPath, "utf8"));
      const hints = [...priorHints];
      for (const m of unprocessed) {
        hints.push({
          sought: m.sought,
          reason: m.reason,
          at: now,
          resolved_paths: bySought[m.sought] ?? [],
          verified: true,
        });
      }
      pc.retrieval_hints = hints.slice(-MAX_HINTS);
      const extraHealed = resolvedPaths.filter(Boolean);
      if (extraHealed.length) {
        pc.healed_paths = [
          ...new Set([...(pc.healed_paths ?? []), ...extraHealed]),
        ].slice(0, MAX_HEALED_PATHS);
      }
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
