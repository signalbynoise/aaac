/**
 * V6 — Retrieve repository memory: dense + sparse + graph expand → capped packet.
 */
import { getEmbeddingProvider } from "./embed/provider.mjs";
import { buildTaskDocument } from "./task-document.mjs";
import { loadRetrievalConfig } from "./paths.mjs";
import {
  loadRepoGraph,
  verifyRepoGraph,
  neighborsOf,
} from "./repo-graph.mjs";
import { loadRepoScratchpad, scratchpadExcerpt } from "./repo-scratchpad.mjs";
import { searchRepoVectors, getRepoVector } from "./repo-index/build.mjs";
import { getRepoVectorIndex } from "./repo-index/hnsw.mjs";
import { relationsForPacket } from "./repo-index/relations.mjs";
import {
  expandCandidatePaths,
  rankFocusSpans,
  buildReadPack,
} from "./repo-index/span-retrieve.mjs";
import { emitRepoMemoryEvent } from "./repo-events.mjs";
import { cosine } from "./index/hnsw.mjs";

function emptyRepoMemoryPacket(extra = {}) {
  return {
    focus_paths: [],
    avoid_paths: [],
    nodes: [],
    invariants: [],
    edges: [],
    scratchpad_excerpt: "",
    impact: [],
    entry_flows: [],
    clusters: [],
    call_neighbors: [],
    focus_spans: [],
    read_pack: { spans: [], impact: [], call_neighbors: [], entry_flows: [] },
    ...extra,
  };
}

function basenameTokens(filePath) {
  const base = String(filePath ?? "")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "") ?? "";
  return tokenize(base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " "));
}

function pathFamilyKey(filePath) {
  const parts = String(filePath ?? "").split("/");
  const base = parts.pop() ?? "";
  const dir = parts.slice(-2).join("/");
  const stem = base.replace(/\.[^.]+$/, "").replace(/([a-z])([A-Z])/g, "$1_$2");
  const family = stem.split(/[_-]/)[0] ?? stem;
  return `${dir}/${family}`.toLowerCase();
}

function isBarrelPath(filePath) {
  const base = String(filePath ?? "").split("/").pop() ?? "";
  return /^(index|main)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(base);
}

function pathExistsInActive(active, filePath) {
  const want = String(filePath ?? "").replace(/\\/g, "/");
  return Object.values(active).some((n) => n.path === want);
}

function nodeEntryForPath(active, filePath) {
  const want = String(filePath ?? "").replace(/\\/g, "/");
  return Object.entries(active).find(([, n]) => n.path === want) ?? null;
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_./+-]+/)
    .filter((t) => t.length > 1);
}

function buildSparseRepoIndex(nodes) {
  const inverted = new Map();
  const docLen = new Map();
  let totalLen = 0;
  let docCount = 0;
  for (const node of Object.values(nodes)) {
    const text = [
      node.id,
      node.path,
      node.summary,
      node.api,
      node.claim,
      node.trigger,
      ...(node.tags ?? []),
    ].join(" ");
    const tokens = tokenize(text);
    docLen.set(node.id, tokens.length);
    totalLen += tokens.length;
    docCount += 1;
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, count] of tf) {
      if (!inverted.has(term)) inverted.set(term, new Map());
      inverted.get(term).set(node.id, count);
    }
  }
  const avgDl = docCount ? totalLen / docCount : 1;
  return {
    search(queryText, k = 16) {
      const qTokens = tokenize(queryText);
      if (!qTokens.length || !docCount) return [];
      const scores = new Map();
      const k1 = 1.2;
      const b = 0.75;
      for (const term of qTokens) {
        const postings = inverted.get(term);
        if (!postings) continue;
        const df = postings.size;
        const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
        for (const [docId, tf] of postings) {
          const dl = docLen.get(docId) ?? 1;
          const denom = tf + k1 * (1 - b + b * (dl / avgDl));
          scores.set(docId, (scores.get(docId) ?? 0) + idf * ((tf * (k1 + 1)) / denom));
        }
      }
      return [...scores.entries()]
        .map(([nodeId, score]) => ({ nodeId, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}

function rrfFuse(rankLists, k = 60) {
  const scores = new Map();
  for (const list of rankLists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()]
    .map(([nodeId, score]) => ({ nodeId, score }))
    .sort((a, b) => b.score - a.score);
}

function selectMmrNodes(ranked, k, lambda = 0.7) {
  const selected = [];
  const remaining = [...ranked];
  while (selected.length < k && remaining.length) {
    let bestIdx = 0;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const cand = remaining[i];
      let maxSim = 0;
      for (const s of selected) {
        if (cand.vector && s.vector) {
          maxSim = Math.max(maxSim, cosine(cand.vector, s.vector));
        }
        // Diversify by path family so MemoryGraph* siblings aren't all dropped
        if (
          cand.node?.path &&
          s.node?.path &&
          pathFamilyKey(cand.node.path) === pathFamilyKey(s.node.path)
        ) {
          maxSim = Math.max(maxSim, 0.55);
        }
      }
      const mmr = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}

function mergeStage1Neighbors(graph, active, focusPaths, picked, neighborCap) {
  if (!neighborCap || !focusPaths.length) return { focusPaths, picked };
  const pathToNode = new Map(
    Object.values(active)
      .filter((n) => n.path)
      .map((n) => [n.path, n]),
  );
  const pathSet = new Set(focusPaths);
  const expanded = expandCandidatePaths(graph, focusPaths, {
    neighborCap,
  }).filter((p) => !isBarrelPath(p) || focusPaths.includes(p));
  const added = [];
  for (const p of expanded) {
    if (pathSet.has(p)) continue;
    if (isBarrelPath(p)) continue;
    pathSet.add(p);
    added.push(p);
    if (added.length >= neighborCap) break;
  }
  const nextPaths = [...focusPaths, ...added];
  const nextPicked = [...picked];
  for (const p of added) {
    const node = pathToNode.get(p);
    if (!node) continue;
    nextPicked.push({
      nodeId: node.id,
      node,
      score: 0.05,
      vector: getRepoVector(node.id, "summary"),
    });
  }
  return { focusPaths: nextPaths, picked: nextPicked };
}

/**
 * Normalize retrievalHints from prepare / heal artifacts.
 * @param {object|null|undefined} hints
 * @returns {{ paths: string[], sought: string[], recentFailures: string[] }}
 */
export function normalizeRetrievalHints(hints = null) {
  if (!hints || typeof hints !== "object") {
    return { paths: [], sought: [], recentFailures: [] };
  }
  const paths = [
    ...new Set(
      [
        ...(Array.isArray(hints.paths) ? hints.paths : []),
        ...(Array.isArray(hints.resolved_paths) ? hints.resolved_paths : []),
        ...(Array.isArray(hints.hint_paths) ? hints.hint_paths : []),
      ]
        .map((p) => String(p ?? "").replace(/\\/g, "/").trim())
        .filter(Boolean),
    ),
  ];
  const sought = [
    ...new Set(
      [
        ...(Array.isArray(hints.sought) ? hints.sought : []),
        ...(Array.isArray(hints.sought_terms) ? hints.sought_terms : []),
        ...(Array.isArray(hints.retrieval_hints)
          ? hints.retrieval_hints.map((h) => h?.sought).filter(Boolean)
          : []),
      ]
        .map((s) => String(s).trim())
        .filter(Boolean),
    ),
  ];
  const recentFailures = [
    ...new Set(
      [
        ...(Array.isArray(hints.recentFailures) ? hints.recentFailures : []),
        ...sought,
      ]
        .map((s) => String(s).trim())
        .filter(Boolean),
    ),
  ];
  return { paths, sought, recentFailures };
}

/**
 * @param {object} manifest
 * @param {{
 *   provider?: object,
 *   emit?: boolean,
 *   maxNodes?: number,
 *   retrievalHints?: object|null,
 * }} [options]
 */
export async function retrieveRepoMemory(manifest, options = {}) {
  const started = Date.now();
  const cfg = loadRetrievalConfig();
  const rm = cfg.repo_memory ?? {};
  const maxNodes = options.maxNodes ?? rm.final_nodes ?? 12;
  const maxInv = rm.max_invariants ?? 8;
  const hops = rm.graph_hops ?? 1;
  const provider = options.provider ?? getEmbeddingProvider(options);
  const emit = options.emit !== false;
  const hintNorm = normalizeRetrievalHints(
    options.retrievalHints ?? options.queryBoost ?? null,
  );

  const graph = loadRepoGraph();
  const { invalidated } = verifyRepoGraph(graph);
  const active = Object.fromEntries(
    Object.entries(graph.nodes ?? {}).filter(([, n]) => n.valid !== false),
  );
  const staleDropped = invalidated;

  if (!Object.keys(active).length) {
    const empty = emptyRepoMemoryPacket({
      meta: {
        candidates: 0,
        latency_ms: Date.now() - started,
        stale_dropped: staleDropped,
        empty: true,
        provider: provider.id,
        retrieval_hints: hintNorm.sought.length || hintNorm.paths.length
          ? hintNorm
          : undefined,
      },
    });
    if (emit) {
      emitRepoMemoryEvent({
        phase: "retrieve_done",
        detail: { nodes: 0, empty: true, stale_dropped: staleDropped },
      });
    }
    return empty;
  }

  const { text: taskText } = buildTaskDocument(manifest, {
    paths: hintNorm.paths,
    sought: hintNorm.sought,
    recentFailures: hintNorm.recentFailures,
  });
  const [queryVec] = await provider.embed([taskText]);

  const denseStarted = Date.now();
  const vectorIndex = getRepoVectorIndex();
  const denseK = rm.semantic_candidates ?? cfg.semantic_candidates ?? 32;
  const denseSummary = searchRepoVectors(queryVec, {
    k: denseK,
    slot: "summary",
  });
  const denseApi = searchRepoVectors(queryVec, {
    k: denseK,
    slot: "api",
  });
  const denseLatencyMs = Date.now() - denseStarted;
  const denseScore = new Map();
  for (const h of denseSummary) {
    denseScore.set(h.nodeId, Math.max(denseScore.get(h.nodeId) ?? 0, h.score));
  }
  for (const h of denseApi) {
    denseScore.set(h.nodeId, Math.max(denseScore.get(h.nodeId) ?? 0, h.score * 0.95));
  }
  const denseRank = [...denseScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const sparse = buildSparseRepoIndex(active);
  const sparseHits = sparse.search(taskText, rm.lexical_candidates ?? 16);
  const sparseRank = sparseHits.map((h) => h.nodeId);

  let fused = rrfFuse(
    [denseRank, denseSummary.map((h) => h.nodeId), denseApi.map((h) => h.nodeId), sparseRank],
    cfg.rrf_k,
  );

  // Basename / camelCase boost when query tokens match path stem
  const qTokens = new Set(tokenize(taskText));
  const basenameBoost = Number(rm.basename_boost ?? 0.25);
  if (basenameBoost > 0) {
    fused = fused.map((f) => {
      const node = active[f.nodeId];
      if (!node?.path) return f;
      const bTokens = basenameTokens(node.path);
      let hits = 0;
      for (const t of bTokens) {
        if (qTokens.has(t)) hits += 1;
      }
      if (!hits) return f;
      return {
        nodeId: f.nodeId,
        score: f.score + basenameBoost * (hits / Math.max(1, bTokens.length)),
      };
    }).sort((a, b) => b.score - a.score);
  }

  // Graph expansion — prefer structural kinds over related
  const expanded = new Map(fused.map((f) => [f.nodeId, f.score]));
  const expandKinds = ["imports", "imported_by", "calls", "called_by", "tests", "tested_by"];
  for (let hop = 0; hop < hops; hop += 1) {
    const seeds = [...expanded.keys()].slice(0, cfg.semantic_candidates ?? 32);
    for (const seed of seeds) {
      for (const n of neighborsOf(graph, seed, {
        kinds: expandKinds,
        limit: cfg.max_neighbours_per_seed ?? 8,
      })) {
        if (!active[n.id]) continue;
        // Demote barrel hubs during expansion
        if (isBarrelPath(active[n.id].path)) {
          expanded.set(n.id, (expanded.get(n.id) ?? 0) + 0.04 * (n.edge.weight ?? 1));
          continue;
        }
        expanded.set(n.id, (expanded.get(n.id) ?? 0) + 0.12 * (n.edge.weight ?? 1));
      }
    }
  }
  fused = [...expanded.entries()]
    .map(([nodeId, score]) => ({ nodeId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.rerank_limit ?? 96);

  const candidates = [];
  for (const { nodeId, score } of fused) {
    const node = active[nodeId];
    if (!node) continue;
    const vector = getRepoVector(nodeId, "summary") ?? getRepoVector(nodeId, "api");
    const semantic = denseScore.get(nodeId) ?? 0;
    candidates.push({
      nodeId,
      node,
      score: score + 0.35 * semantic,
      vector,
    });
  }
  candidates.sort((a, b) => b.score - a.score);

  // Seed / boost hint paths ahead of MMR so miss-heal sticks in focus
  if (hintNorm.paths.length) {
    const hintSet = new Set(hintNorm.paths);
    for (const c of candidates) {
      if (hintSet.has(c.node.path)) c.score += 50;
    }
    for (const p of hintNorm.paths) {
      const entry = nodeEntryForPath(active, p);
      if (!entry) continue;
      const [nodeId, node] = entry;
      if (candidates.some((c) => c.nodeId === nodeId)) continue;
      candidates.push({
        nodeId,
        node,
        score: 1e6,
        vector: getRepoVector(nodeId, "summary") ?? getRepoVector(nodeId, "api"),
      });
    }
    candidates.sort((a, b) => b.score - a.score);
  }

  let picked = selectMmrNodes(candidates, maxNodes, cfg.mmr_lambda ?? 0.7);
  const pickedIds = new Set(picked.map((c) => c.nodeId));
  for (const p of hintNorm.paths) {
    const entry = nodeEntryForPath(active, p);
    if (!entry) continue;
    const [nodeId, node] = entry;
    if (pickedIds.has(nodeId)) continue;
    picked.push({
      nodeId,
      node,
      score: 1e6,
      vector: getRepoVector(nodeId, "summary") ?? getRepoVector(nodeId, "api"),
    });
    pickedIds.add(nodeId);
  }
  picked = picked.slice(0, Math.max(maxNodes, hintNorm.paths.length + 2));
  let focusPaths = [
    ...new Set([
      ...hintNorm.paths.filter((p) => pathExistsInActive(active, p)),
      ...picked.map((c) => c.node.path).filter(Boolean),
    ]),
  ];
  ({ focusPaths, picked } = mergeStage1Neighbors(
    graph,
    active,
    focusPaths,
    picked,
    rm.stage1_neighbor_files ?? 6,
  ));
  const avoidPaths = [
    ...new Set(
      Object.values(active)
        .filter((n) => n.kind === "claim" && n.tags?.includes("skip"))
        .flatMap((n) => n.source_files ?? [])
        .filter(Boolean),
    ),
  ].slice(0, 20);

  const nodeIds = new Set(picked.map((c) => c.nodeId));
  const edgeOut = (graph.edges ?? [])
    .filter((e) => nodeIds.has(e.from) || nodeIds.has(e.to))
    .slice(0, 40);

  const invariants = Object.values(active)
    .filter((n) => n.kind === "invariant")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, maxInv)
    .map((n) => ({
      id: n.id,
      claim: n.claim || n.summary,
      source_files: n.source_files ?? [],
      hash_ok: n.valid !== false,
      confidence: n.confidence,
    }));

  // Prefer invariants linked to retrieved nodes
  const linkedInv = Object.values(active)
    .filter((n) => n.kind === "invariant")
    .filter((n) =>
      (n.source_files ?? []).some((p) => focusPaths.includes(p)),
    );
  const invMerged = [
    ...linkedInv.map((n) => ({
      id: n.id,
      claim: n.claim || n.summary,
      source_files: n.source_files ?? [],
      hash_ok: n.valid !== false,
      confidence: n.confidence,
    })),
    ...invariants,
  ];
  const seenInv = new Set();
  const invOut = [];
  for (const inv of invMerged) {
    if (seenInv.has(inv.id)) continue;
    seenInv.add(inv.id);
    invOut.push(inv);
    if (invOut.length >= maxInv) break;
  }

  const pad = loadRepoScratchpad();
  const relational = relationsForPacket(graph, picked, rm);

  // Stage 2 — symbol/span intelligence inside Stage-1 (+ capped neighbors)
  const spanPaths = expandCandidatePaths(graph, focusPaths, {
    neighborCap: rm.symbol_neighbor_files ?? 8,
  });
  const focusSpans = rankFocusSpans({
    queryText: taskText,
    queryVec,
    candidatePaths: spanPaths,
    rm,
    rrfK: cfg.rrf_k,
  });
  const read_pack = buildReadPack({
    focusSpans,
    impact: relational.impact,
    call_neighbors: relational.call_neighbors,
    entry_flows: relational.entry_flows,
    maxSpans: rm.final_spans ?? 8,
  });

  const packet = {
    focus_paths: focusPaths,
    avoid_paths: avoidPaths,
    nodes: picked.map((c) => ({
      id: c.nodeId,
      path: c.node.path,
      kind: c.node.kind,
      summary: c.node.summary,
      score: Math.round(c.score * 1000) / 1000,
      hash_ok: c.node.valid !== false,
    })),
    invariants: invOut,
    edges: edgeOut,
    scratchpad_excerpt: scratchpadExcerpt(pad, 1200),
    impact: relational.impact,
    entry_flows: relational.entry_flows,
    clusters: relational.clusters,
    call_neighbors: relational.call_neighbors,
    focus_spans: focusSpans,
    read_pack,
    meta: {
      read_budgets: {
        max_agent_files_read: rm.max_agent_files_read ?? 16,
        max_full_file_opens: rm.max_full_file_opens ?? 4,
        max_gap_search_globs: rm.max_gap_search_globs ?? 8,
      },
      candidates: fused.length,
      latency_ms: Date.now() - started,
      dense_latency_ms: denseLatencyMs,
      index_backend: vectorIndex.backend,
      index_size: vectorIndex.size(),
      stale_dropped: staleDropped,
      empty: false,
      provider: provider.id,
      nodes_returned: picked.length,
      focus_spans: focusSpans.length,
      span_candidate_files: spanPaths.length,
      retrieval_hints_applied: Boolean(
        hintNorm.paths.length || hintNorm.sought.length,
      ),
      hint_paths: hintNorm.paths.slice(0, 16),
      sought_terms: hintNorm.sought.slice(0, 16),
    },
  };

  for (const c of picked) {
    if (graph.nodes[c.nodeId]) {
      graph.nodes[c.nodeId].hits = (graph.nodes[c.nodeId].hits ?? 0) + 1;
    }
  }

  if (emit) {
    emitRepoMemoryEvent({
      phase: "retrieve_done",
      detail: {
        nodes: packet.nodes.length,
        invariants: packet.invariants.length,
        focus_paths: packet.focus_paths.length,
        focus_spans: packet.focus_spans.length,
        stale_dropped: staleDropped,
        latency_ms: packet.meta.latency_ms,
        dense_latency_ms: denseLatencyMs,
        index_backend: vectorIndex.backend,
        index_size: vectorIndex.size(),
        empty: false,
      },
    });
  }

  return packet;
}
