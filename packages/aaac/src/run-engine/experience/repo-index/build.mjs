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
  REPO_VECTOR_SLOTS,
  loadRetrievalConfig,
} from "../paths.mjs";
import {
  loadRepoGraph,
  saveRepoGraph,
  upsertNode,
  upsertEdge,
  verifyRepoGraph,
  countNodesByKind,
} from "../repo-graph.mjs";
import { scanWorkspace } from "./scan.mjs";
import { emitRepoMemoryEvent } from "../repo-events.mjs";

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
  const meta = loadMeta();
  const vectors = loadVectors();
  vectors.dims = provider.dims;
  meta.provider = provider.id;
  meta.model = provider.model;
  meta.dims = provider.dims;

  const nodeIds = options.nodeIds ?? Object.keys(graph.nodes ?? {});
  let upserted = 0;
  let skipped = 0;

  for (const id of nodeIds) {
    const node = graph.nodes[id];
    if (!node) continue;
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

  saveMeta(meta);
  saveVectors(vectors);
  return { ok: true, upserted, skipped, provider: provider.id, dims: provider.dims };
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a?.length ?? 0, b?.length ?? 0);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

/**
 * Dense search over repo vectors for a slot (default summary).
 */
export function searchRepoVectors(queryVec, { k = 32, slot = "summary" } = {}) {
  const vectors = loadVectors();
  const scored = [];
  for (const [key, vec] of Object.entries(vectors.entries ?? {})) {
    if (!key.endsWith(`::${slot}`)) continue;
    const nodeId = key.slice(0, -(slot.length + 2));
    scored.push({ nodeId, slot, score: cosine(queryVec, vec), vector: vec });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export function getRepoVector(nodeId, slot = "summary") {
  const vectors = loadVectors();
  return vectors.entries?.[`${nodeId}::${slot}`] ?? null;
}

/**
 * Full or incremental index of the workspace into repo-graph + vectors.
 */
export async function buildRepoIndex(options = {}) {
  const emit = options.emit !== false;
  if (emit) emitRepoMemoryEvent({ phase: "index_start", detail: {} });

  try {
    const scanned = scanWorkspace(options);
    const graph = options.graph ?? loadRepoGraph();
    for (const n of scanned.nodes) upsertNode(graph, n);
    for (const e of scanned.edges) {
      upsertEdge(graph, e.from, e.to, e.kind, e.weight);
    }
    verifyRepoGraph(graph);
    saveRepoGraph(graph);

    const indexResult = await upsertRepoNodesIntoIndex(graph, {
      provider: options.provider,
      force: options.force,
      nodeIds: options.nodeIds,
    });

    const kinds = countNodesByKind(graph);
    const detail = {
      nodes: Object.keys(graph.nodes).length,
      edges: graph.edges.length,
      invariants: kinds.invariant ?? 0,
      files: kinds.file ?? 0,
      upserted: indexResult.upserted,
      skipped: indexResult.skipped,
      provider: indexResult.provider,
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
    saveRepoGraph(graph);
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
