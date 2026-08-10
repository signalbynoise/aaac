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
import { emitRepoMemoryEvent } from "./repo-events.mjs";
import { cosine } from "./index/hnsw.mjs";

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

/**
 * @param {object} manifest
 * @param {{ provider?: object, emit?: boolean, maxNodes?: number }} [options]
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

  const graph = loadRepoGraph();
  const { invalidated } = verifyRepoGraph(graph);
  const active = Object.fromEntries(
    Object.entries(graph.nodes ?? {}).filter(([, n]) => n.valid !== false),
  );
  const staleDropped = invalidated;

  if (!Object.keys(active).length) {
    const empty = {
      focus_paths: [],
      avoid_paths: [],
      nodes: [],
      invariants: [],
      edges: [],
      scratchpad_excerpt: "",
      meta: {
        candidates: 0,
        latency_ms: Date.now() - started,
        stale_dropped: staleDropped,
        empty: true,
        provider: provider.id,
      },
    };
    if (emit) {
      emitRepoMemoryEvent({
        phase: "retrieve_done",
        detail: { nodes: 0, empty: true, stale_dropped: staleDropped },
      });
    }
    return empty;
  }

  const { text: taskText } = buildTaskDocument(manifest, {});
  const [queryVec] = await provider.embed([taskText]);

  const denseHits = searchRepoVectors(queryVec, {
    k: rm.semantic_candidates ?? cfg.semantic_candidates ?? 32,
    slot: "summary",
  });
  const denseRank = denseHits.map((h) => h.nodeId);
  const denseScore = new Map(denseHits.map((h) => [h.nodeId, h.score]));

  const sparse = buildSparseRepoIndex(active);
  const sparseHits = sparse.search(taskText, rm.lexical_candidates ?? 16);
  const sparseRank = sparseHits.map((h) => h.nodeId);

  let fused = rrfFuse([denseRank, sparseRank], cfg.rrf_k);

  // Graph expansion
  const expanded = new Map(fused.map((f) => [f.nodeId, f.score]));
  for (let hop = 0; hop < hops; hop += 1) {
    const seeds = [...expanded.keys()].slice(0, cfg.semantic_candidates ?? 32);
    for (const seed of seeds) {
      for (const n of neighborsOf(graph, seed, {
        limit: cfg.max_neighbours_per_seed ?? 8,
      })) {
        if (!active[n.id]) continue;
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
    const vector = getRepoVector(nodeId, "summary");
    const semantic = denseScore.get(nodeId) ?? 0;
    candidates.push({
      nodeId,
      node,
      score: score + 0.35 * semantic,
      vector,
    });
  }
  candidates.sort((a, b) => b.score - a.score);

  const picked = selectMmrNodes(candidates, maxNodes, cfg.mmr_lambda ?? 0.7);
  const focusPaths = [
    ...new Set(picked.map((c) => c.node.path).filter(Boolean)),
  ];
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
    meta: {
      candidates: fused.length,
      latency_ms: Date.now() - started,
      stale_dropped: staleDropped,
      empty: false,
      provider: provider.id,
      nodes_returned: picked.length,
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
        stale_dropped: staleDropped,
        latency_ms: packet.meta.latency_ms,
        empty: false,
      },
    });
  }

  return packet;
}
