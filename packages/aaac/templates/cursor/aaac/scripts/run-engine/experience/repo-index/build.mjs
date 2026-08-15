/**
 * V6 — Build / upsert repository node embeddings into state/repo-index.
 */
import fs from "fs";
import { createHash } from "crypto";
import { getEmbeddingProvider } from "../embed/provider.mjs";
import {
  REPO_INDEX_DIR,
  REPO_INDEX_META_PATH,
  REPO_INDEX_VECTORS_PATH,
  REPO_SYMBOLS_PATH,
  REPO_SYMBOL_VECTORS_PATH,
  REPO_SYMBOL_META_PATH,
  REPO_VECTOR_SLOTS,
  REPO_SYMBOL_VECTOR_SLOT,
  loadRetrievalConfig,
} from "../paths.mjs";
import {
  emptyRepoGraph,
  loadRepoGraph,
  saveRepoGraph,
  upsertNode,
  upsertEdge,
  verifyRepoGraph,
  countNodesByKind,
} from "../repo-graph.mjs";
import { scanWorkspace } from "./scan.mjs";
import { isTestPath } from "./files.mjs";
import { emitRepoMemoryEvent } from "../repo-events.mjs";
import {
  getRepoVectorIndex,
  replaceRepoVectorIndex,
  resetRepoVectorIndexCache,
  cosine,
} from "./hnsw.mjs";
import {
  computeRepoRelations,
  needsRelationsUpgrade,
} from "./relations.mjs";
import {
  emptySymbolsStore,
  symbolEmbedText,
} from "./symbols.mjs";

function contentHash(text) {
  return createHash("sha256").update(String(text ?? "")).digest("hex").slice(0, 16);
}

function ensureDir() {
  fs.mkdirSync(REPO_INDEX_DIR, { recursive: true });
}

function emptyMeta() {
  return { version: 1, rows: {}, provider: null, model: null, dims: null };
}

function loadMeta() {
  ensureDir();
  if (!fs.existsSync(REPO_INDEX_META_PATH)) return emptyMeta();
  try {
    return { ...emptyMeta(), ...JSON.parse(fs.readFileSync(REPO_INDEX_META_PATH, "utf8")) };
  } catch {
    return emptyMeta();
  }
}

function saveMeta(meta) {
  ensureDir();
  fs.writeFileSync(REPO_INDEX_META_PATH, JSON.stringify(meta, null, 2));
}

function loadVectors() {
  ensureDir();
  if (!fs.existsSync(REPO_INDEX_VECTORS_PATH)) {
    return { dims: 384, entries: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(REPO_INDEX_VECTORS_PATH, "utf8"));
  } catch {
    return { dims: 384, entries: {} };
  }
}

function saveVectors(store) {
  ensureDir();
  fs.writeFileSync(REPO_INDEX_VECTORS_PATH, JSON.stringify(store));
}

export function loadSymbolsStore() {
  ensureDir();
  if (!fs.existsSync(REPO_SYMBOLS_PATH)) return emptySymbolsStore();
  try {
    return { ...emptySymbolsStore(), ...JSON.parse(fs.readFileSync(REPO_SYMBOLS_PATH, "utf8")) };
  } catch {
    return emptySymbolsStore();
  }
}

export function saveSymbolsStore(store) {
  ensureDir();
  store.updated_at = new Date().toISOString();
  fs.writeFileSync(REPO_SYMBOLS_PATH, JSON.stringify(store, null, 2));
}

function loadSymbolVectors() {
  ensureDir();
  if (!fs.existsSync(REPO_SYMBOL_VECTORS_PATH)) {
    return { dims: 384, entries: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(REPO_SYMBOL_VECTORS_PATH, "utf8"));
  } catch {
    return { dims: 384, entries: {} };
  }
}

function saveSymbolVectors(store) {
  ensureDir();
  fs.writeFileSync(REPO_SYMBOL_VECTORS_PATH, JSON.stringify(store));
}

function loadSymbolMeta() {
  ensureDir();
  if (!fs.existsSync(REPO_SYMBOL_META_PATH)) {
    return { version: 1, rows: {}, provider: null, model: null, dims: null };
  }
  try {
    return JSON.parse(fs.readFileSync(REPO_SYMBOL_META_PATH, "utf8"));
  } catch {
    return { version: 1, rows: {}, provider: null, model: null, dims: null };
  }
}

function saveSymbolMeta(meta) {
  ensureDir();
  fs.writeFileSync(REPO_SYMBOL_META_PATH, JSON.stringify(meta, null, 2));
}

/**
 * Replace symbols sidecar from a scan batch (keyed by id).
 */
export function persistScannedSymbols(symbolList, { merge = false } = {}) {
  const store = merge ? loadSymbolsStore() : emptySymbolsStore();
  if (!merge) store.symbols = {};
  for (const symbol of symbolList ?? []) {
    if (!symbol?.id) continue;
    store.symbols[symbol.id] = symbol;
  }
  saveSymbolsStore(store);
  return store;
}

/**
 * Embed symbol records (hash-skip when content_hash unchanged).
 */
export async function upsertSymbolsIntoIndex(symbolList, options = {}) {
  const provider = options.provider ?? getEmbeddingProvider(options);
  const resetStore = Boolean(options.force);
  const meta = resetStore
    ? { version: 1, rows: {}, provider: null, model: null, dims: null }
    : loadSymbolMeta();
  const vectors = resetStore
    ? { dims: provider.dims, entries: {} }
    : loadSymbolVectors();
  vectors.dims = provider.dims;
  meta.provider = provider.id;
  meta.model = provider.model;
  meta.dims = provider.dims;

  const list = symbolList ?? Object.values(loadSymbolsStore().symbols ?? {});
  let upserted = 0;
  let skipped = 0;
  const slot = REPO_SYMBOL_VECTOR_SLOT;

  for (const symbol of list) {
    if (!symbol?.id) continue;
    const text = symbolEmbedText(symbol);
    const hash = contentHash(text);
    const prev = meta.rows[symbol.id];
    const needs =
      options.force ||
      !prev ||
      prev.provider !== provider.id ||
      prev.hash !== hash ||
      prev.content_hash !== symbol.content_hash;
    if (!needs) {
      skipped += 1;
      continue;
    }
    const [embed] = await provider.embed([text]);
    vectors.entries[`${symbol.id}::${slot}`] = Array.from(embed);
    meta.rows[symbol.id] = {
      hash,
      content_hash: symbol.content_hash,
      provider: provider.id,
      model: provider.model,
      path: symbol.path,
      updated_at: new Date().toISOString(),
    };
    upserted += 1;
  }

  // Drop vectors for symbols no longer present when doing a full replace batch
  if (options.prune !== false && symbolList) {
    const keep = new Set(symbolList.map((s) => s.id));
    for (const key of Object.keys(vectors.entries)) {
      const id = key.split("::")[0];
      if (!keep.has(id)) delete vectors.entries[key];
    }
    for (const id of Object.keys(meta.rows)) {
      if (!keep.has(id)) delete meta.rows[id];
    }
  }

  saveSymbolMeta(meta);
  saveSymbolVectors(vectors);
  return {
    ok: true,
    upserted,
    skipped,
    provider: provider.id,
    dims: provider.dims,
    count: Object.keys(vectors.entries).length,
  };
}

export function getSymbolVector(symbolId, slot = REPO_SYMBOL_VECTOR_SLOT) {
  const vectors = loadSymbolVectors();
  return vectors.entries?.[`${symbolId}::${slot}`] ?? null;
}

/**
 * Dense search over symbol vectors, optionally restricted to path set.
 */
export function searchSymbolVectors(
  queryVec,
  { k = 32, paths = null, pathSet = null } = {},
) {
  const allow = pathSet ?? (paths ? new Set(paths) : null);
  const store = loadSymbolsStore();
  const vectors = loadSymbolVectors();
  const slot = REPO_SYMBOL_VECTOR_SLOT;
  const scored = [];
  for (const [key, vector] of Object.entries(vectors.entries ?? {})) {
    if (!key.endsWith(`::${slot}`)) continue;
    const symbolId = key.slice(0, -(`::${slot}`).length);
    const symbol = store.symbols?.[symbolId];
    if (!symbol) continue;
    if (allow && !allow.has(symbol.path)) continue;
    scored.push({
      symbolId,
      symbol,
      score: cosine(queryVec, vector),
      vector,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function slotTexts(node) {
  return {
    summary: node.summary || node.path || node.id,
    api: node.api || node.summary || "",
    invariant: node.claim || node.summary || "",
    trigger: node.trigger || node.path || node.tags?.join(" ") || "",
  };
}

/**
 * Upsert embeddings for graph nodes (hash-skip when unchanged).
 */
export async function upsertRepoNodesIntoIndex(graph, options = {}) {
  const provider = options.provider ?? getEmbeddingProvider(options);
  const resetStore = options.force && !options.nodeIds;
  const meta = resetStore ? emptyMeta() : loadMeta();
  const vectors = resetStore ? { dims: provider.dims, entries: {} } : loadVectors();
  vectors.dims = provider.dims;
  meta.provider = provider.id;
  meta.model = provider.model;
  meta.dims = provider.dims;

  const nodeIds = options.nodeIds ?? Object.keys(graph.nodes ?? {});
  let upserted = 0;
  let skipped = 0;
  const emitProgress = options.emitProgress !== false;
  const total = nodeIds.length;
  let processed = 0;

  for (const id of nodeIds) {
    const node = graph.nodes[id];
    if (!node) continue;
    processed += 1;
    if (emitProgress && (processed === 1 || processed % 200 === 0 || processed === total)) {
      emitRepoMemoryEvent({
        phase: "index_progress",
        detail: { done: processed, total, upserted, skipped },
      });
    }
    const texts = slotTexts(node);
    const hashes = Object.fromEntries(
      REPO_VECTOR_SLOTS.map((s) => [s, contentHash(texts[s])]),
    );
    const prev = meta.rows[id];
    const needs =
      options.force ||
      !prev ||
      prev.provider !== provider.id ||
      REPO_VECTOR_SLOTS.some((s) => prev.hashes?.[s] !== hashes[s]);
    if (!needs) {
      skipped += 1;
      continue;
    }
    const ordered = REPO_VECTOR_SLOTS.map((s) => texts[s]);
    const embeds = await provider.embed(ordered);
    for (let i = 0; i < REPO_VECTOR_SLOTS.length; i += 1) {
      const slot = REPO_VECTOR_SLOTS[i];
      const key = `${id}::${slot}`;
      vectors.entries[key] = Array.from(embeds[i]);
    }
    meta.rows[id] = {
      hashes,
      provider: provider.id,
      model: provider.model,
      updated_at: new Date().toISOString(),
    };
    upserted += 1;
  }

  if (!options.nodeIds) {
    const keep = new Set(Object.keys(graph.nodes ?? {}));
    for (const id of Object.keys(meta.rows)) {
      if (!keep.has(id)) delete meta.rows[id];
    }
    for (const key of Object.keys(vectors.entries)) {
      const id = key.split("::")[0];
      if (!keep.has(id)) delete vectors.entries[key];
    }
  }

  saveMeta(meta);
  saveVectors(vectors);
  // Refresh HNSW (usearch) derived index from portable JSON SSOT.
  const hnsw = replaceRepoVectorIndex(vectors, { persist: true });
  return {
    ok: true,
    upserted,
    skipped,
    provider: provider.id,
    dims: provider.dims,
    index_backend: hnsw.backend,
  };
}

/**
 * Dense search over repo vectors for a slot (default summary).
 * Prefers HNSW (usearch); pass backend:"brute" for exact scan.
 */
export function searchRepoVectors(
  queryVec,
  { k = 32, slot = "summary", backend = "auto" } = {},
) {
  const index = getRepoVectorIndex({
    backend: backend === "brute" ? "brute" : backend === "usearch" ? "usearch" : "auto",
  });
  return index.search(queryVec, k, { slot }).map((hit) => ({
    nodeId: hit.nodeId,
    slot: hit.slot,
    score: hit.score,
    vector: hit.vector,
  }));
}

export function getRepoVector(nodeId, slot = "summary") {
  const index = getRepoVectorIndex();
  const fromIndex = index.getVector(nodeId, slot);
  if (fromIndex) return Array.from(fromIndex);
  const vectors = loadVectors();
  return vectors.entries?.[`${nodeId}::${slot}`] ?? null;
}

function addSemanticGlueEdges(
  graph,
  { neighbours = 2, minScore = 0.2 } = {},
) {
  const candidateIds = Object.values(graph.nodes ?? {})
    .filter((node) => node.kind === "file" || node.kind === "test")
    .map((node) => node.id);
  const connected = new Set();
  for (const edge of graph.edges ?? []) {
    if (edge.kind === "member_of") continue;
    connected.add(edge.from);
    connected.add(edge.to);
  }
  let semanticEdges = 0;
  for (const nodeId of candidateIds) {
    if (connected.has(nodeId)) continue;
    const vector = getRepoVector(nodeId, "summary");
    if (!vector) continue;
    const nearest = searchRepoVectors(vector, {
      k: neighbours + 4,
      slot: "summary",
    })
      .filter((candidate) => candidate.nodeId !== nodeId && candidate.score >= minScore)
      .slice(0, neighbours);
    for (const candidate of nearest) {
      upsertEdge(graph, nodeId, candidate.nodeId, "related", candidate.score);
      upsertEdge(graph, candidate.nodeId, nodeId, "related", candidate.score);
      connected.add(nodeId);
      connected.add(candidate.nodeId);
      semanticEdges += 2;
    }
  }
  return semanticEdges;
}

function shouldIndexTests() {
  return loadRetrievalConfig().repo_memory?.index_include_tests === true;
}

function pruneTestGraphNodes(graph) {
  if (shouldIndexTests()) return [];
  const dropped = [];
  for (const [id, node] of Object.entries(graph.nodes ?? {})) {
    if (node?.kind === "test" || isTestPath(node?.path ?? "")) {
      dropped.push(id);
      delete graph.nodes[id];
    }
  }
  if (!dropped.length) return dropped;
  const drop = new Set(dropped);
  graph.edges = (graph.edges ?? []).filter(
    (edge) => !drop.has(edge.from) && !drop.has(edge.to),
  );
  return dropped;
}

/**
 * Full or incremental index of the workspace into repo-graph + vectors.
 */
export async function buildRepoIndex(options = {}) {
  const emit = options.emit !== false;
  if (emit) emitRepoMemoryEvent({ phase: "index_start", detail: {} });

  try {
    const scanned = await scanWorkspace(options);
    const graph = options.graph ?? (options.force ? emptyRepoGraph() : loadRepoGraph());
    for (const n of scanned.nodes) upsertNode(graph, n);
    for (const e of scanned.edges) {
      upsertEdge(graph, e.from, e.to, e.kind, e.weight);
    }
    pruneTestGraphNodes(graph);
    verifyRepoGraph(graph);
    // Persist structure first so the UI can stream-load the graph before embeddings finish.
    saveRepoGraph(graph);
    const symbolsStore = persistScannedSymbols(scanned.symbols ?? [], {
      merge: false,
    });
    const kindsEarly = countNodesByKind(graph);
    const graphDetail = {
      nodes: Object.keys(graph.nodes).length,
      edges: graph.edges.length,
      invariants: kindsEarly.invariant ?? 0,
      files: kindsEarly.file ?? 0,
      symbols: Object.keys(symbolsStore.symbols ?? {}).length,
    };
    if (emit) {
      emitRepoMemoryEvent({ phase: "graph_ready", detail: graphDetail });
    }

    const indexResult = await upsertRepoNodesIntoIndex(graph, {
      provider: options.provider,
      force: options.force,
      nodeIds: options.nodeIds,
      emitProgress: emit,
    });
    const symbolIndexResult = await upsertSymbolsIntoIndex(
      Object.values(symbolsStore.symbols ?? {}),
      {
        provider: options.provider,
        force: options.force,
        prune: true,
      },
    );
    if (emit) {
      emitRepoMemoryEvent({
        phase: "symbols_ready",
        detail: {
          symbols: Object.keys(symbolsStore.symbols ?? {}).length,
          upserted: symbolIndexResult.upserted,
          skipped: symbolIndexResult.skipped,
        },
      });
    }
    const semanticEdges = addSemanticGlueEdges(graph);
    if (semanticEdges > 0) {
      verifyRepoGraph(graph);
      saveRepoGraph(graph);
      if (emit) {
        emitRepoMemoryEvent({
          phase: "graph_ready",
          detail: {
            ...graphDetail,
            edges: graph.edges.length,
            semantic_edges: semanticEdges,
          },
        });
      }
    }

    const relationsDetail = computeRepoRelations(graph, {
      cfg: loadRetrievalConfig().repo_memory,
    });
    saveRepoGraph(graph);
    if (emit) {
      emitRepoMemoryEvent({
        phase: "relations_ready",
        detail: relationsDetail,
      });
    }

    const kinds = countNodesByKind(graph);
    const detail = {
      nodes: Object.keys(graph.nodes).length,
      edges: graph.edges.length,
      invariants: kinds.invariant ?? 0,
      files: kinds.file ?? 0,
      symbols: Object.keys(symbolsStore.symbols ?? {}).length,
      upserted: indexResult.upserted,
      skipped: indexResult.skipped,
      provider: indexResult.provider,
      semanticEdges,
      relations: relationsDetail,
      symbol_index: symbolIndexResult,
    };
    if (emit) {
      emitRepoMemoryEvent({ phase: "index_done", detail });
    }
    return { ok: true, ...detail, index: indexResult };
  } catch (err) {
    const detail = { error: String(err?.message ?? err).slice(0, 300) };
    if (emit) {
      emitRepoMemoryEvent({ phase: "error", level: "error", detail: { ...detail, where: "index" } });
    }
    return { ok: false, ...detail };
  }
}

/**
 * Ensure index exists; skip rebuild when graph present and mostly valid.
 */
function needsSymbolsUpgrade() {
  if (!fs.existsSync(REPO_SYMBOLS_PATH)) return true;
  try {
    const store = loadSymbolsStore();
    return Object.keys(store.symbols ?? {}).length === 0;
  } catch {
    return true;
  }
}

export async function ensureRepoIndex(options = {}) {
  const graph = loadRepoGraph();
  const nodeCount = Object.keys(graph.nodes ?? {}).length;
  const { invalidated } = verifyRepoGraph(graph);
  const vectors = loadVectors();
  const vectorCount = Object.keys(vectors.entries ?? {}).length;

  if (
    !options.force &&
    nodeCount > 0 &&
    vectorCount > 0 &&
    invalidated / Math.max(1, nodeCount) < 0.25
  ) {
    // Span-first upgrade: existing file graph without symbols sidecar → full rebuild.
    if (needsSymbolsUpgrade()) {
      return buildRepoIndex({ ...options, force: true });
    }
    saveRepoGraph(graph);
    // Ensure HNSW layer is warm even when embeddings are current.
    getRepoVectorIndex({ force: Boolean(options.refreshIndex) });
    if (needsRelationsUpgrade(graph)) {
      const relationsDetail = computeRepoRelations(graph, {
        cfg: loadRetrievalConfig().repo_memory,
      });
      saveRepoGraph(graph);
      emitRepoMemoryEvent({
        phase: "relations_ready",
        detail: { ...relationsDetail, reason: "upgrade" },
      });
    }
    const kinds = countNodesByKind(graph);
    const detail = {
      nodes: nodeCount,
      invariants: kinds.invariant ?? 0,
      skipped: true,
    };
    emitRepoMemoryEvent({ phase: "index_done", detail: { ...detail, reason: "current" } });
    return { ok: true, current: true, ...detail };
  }

  return buildRepoIndex(options);
}

export { resetRepoVectorIndexCache, cosine };
