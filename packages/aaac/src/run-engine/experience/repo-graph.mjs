/**
 * V6 — Repository structural graph + invariants with source-hash invalidation.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { isoNow, readJson, writeJson } from "../lib.mjs";
import { REPO_GRAPH_PATH } from "./paths.mjs";

export const NODE_KINDS = ["file", "module", "test", "invariant", "claim"];
export const EDGE_KINDS = [
  "imports",
  "imported_by",
  "tests",
  "tested_by",
  "calls",
  "called_by",
  "owns",
  "owned_by",
  "depends_on",
  "related",
];

export function emptyRepoGraph() {
  return {
    version: 1,
    updated_at: null,
    nodes: {},
    edges: [],
    relations: {
      updated_at: null,
      clusters: {},
      entries: [],
    },
  };
}

export function loadRepoGraph() {
  return readJson(REPO_GRAPH_PATH, emptyRepoGraph());
}

export function saveRepoGraph(graph) {
  graph.updated_at = isoNow();
  writeJson(REPO_GRAPH_PATH, graph);
}

export function hashFile(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    const buf = fs.readFileSync(absPath);
    return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

export function resolveWorkspaceRoot() {
  return process.env.AAAC_WORKSPACE_ROOT || process.cwd();
}

export function nodeIdForPath(relPath) {
  const norm = String(relPath).replace(/\\/g, "/").replace(/^\.\//, "");
  return `file:${norm}`;
}

export function invariantId(slug) {
  return `inv:${String(slug).replace(/[^a-zA-Z0-9._/-]+/g, "-").slice(0, 80)}`;
}

/**
 * @param {object} graph
 * @param {object} node
 */
export function upsertNode(graph, node) {
  const id = node.id;
  if (!id) throw new Error("repo-graph: node.id required");
  const prev = graph.nodes[id] ?? {};
  const root = resolveWorkspaceRoot();
  const sourceFiles = node.source_files ?? prev.source_files ?? (node.path ? [node.path] : []);
  const hashes = { ...(prev.source_hashes ?? {}) };
  if (node.source_hashes) {
    Object.assign(hashes, node.source_hashes);
  } else {
    for (const rel of sourceFiles) {
      const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
      const h = hashFile(abs);
      if (h) hashes[rel] = h;
    }
  }
  graph.nodes[id] = {
    id,
    kind: node.kind ?? prev.kind ?? "file",
    path: node.path ?? prev.path ?? null,
    summary: node.summary ?? prev.summary ?? "",
    api: node.api ?? prev.api ?? "",
    claim: node.claim ?? prev.claim ?? "",
    trigger: node.trigger ?? prev.trigger ?? "",
    tags: node.tags ?? prev.tags ?? [],
    source_files: sourceFiles,
    source_hashes: hashes,
    confidence: Math.max(prev.confidence ?? 0, node.confidence ?? 0.5),
    valid: node.valid ?? true,
    hits: prev.hits ?? 0,
    last_verified: isoNow(),
    updated_at: isoNow(),
    // Preserve index-time relational answers until recompute.
    fan_in: node.fan_in ?? prev.fan_in,
    fan_out: node.fan_out ?? prev.fan_out,
    blast_score: node.blast_score ?? prev.blast_score,
    blast_dependents: node.blast_dependents ?? prev.blast_dependents,
    cluster_id: node.cluster_id ?? prev.cluster_id,
    is_entry: node.is_entry ?? prev.is_entry,
  };
  return graph.nodes[id];
}

/**
 * @param {object} graph
 * @param {string} from
 * @param {string} to
 * @param {string} kind
 * @param {number} [weight]
 */
export function upsertEdge(graph, from, to, kind, weight = 1) {
  if (!from || !to || !kind) return null;
  const edges = graph.edges ?? [];
  const idx = edges.findIndex(
    (e) => e.from === from && e.to === to && e.kind === kind,
  );
  const edge = { from, to, kind, weight };
  if (idx >= 0) edges[idx] = edge;
  else edges.push(edge);
  graph.edges = edges;
  return edge;
}

/**
 * Re-hash file-backed nodes; mark invalid when content drifts.
 */
export function verifyRepoGraph(graph) {
  const root = resolveWorkspaceRoot();
  let verified = 0;
  let invalidated = 0;
  for (const node of Object.values(graph.nodes ?? {})) {
    const files = node.source_files?.length
      ? node.source_files
      : node.path
        ? [node.path]
        : [];
    if (!files.length) {
      node.valid = true;
      verified += 1;
      continue;
    }
    let ok = true;
    for (const rel of files) {
      const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
      const h = hashFile(abs);
      if (!h) {
        ok = false;
        continue;
      }
      if (node.source_hashes?.[rel] && h !== node.source_hashes[rel]) {
        ok = false;
      }
    }
    node.valid = ok;
    if (ok) {
      node.last_verified = isoNow();
      verified += 1;
    } else {
      invalidated += 1;
    }
    graph.nodes[node.id] = node;
  }
  return { verified, invalidated };
}

export function neighborsOf(graph, nodeId, { kinds = null, limit = 8 } = {}) {
  const edges = (graph.edges ?? []).filter(
    (e) =>
      (e.from === nodeId || e.to === nodeId) &&
      (!kinds || kinds.includes(e.kind)),
  );
  const out = [];
  for (const e of edges.slice(0, limit * 2)) {
    const other = e.from === nodeId ? e.to : e.from;
    if (graph.nodes[other]) out.push({ id: other, edge: e });
    if (out.length >= limit) break;
  }
  return out;
}

export function countNodesByKind(graph) {
  const counts = {};
  for (const n of Object.values(graph.nodes ?? {})) {
    counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  }
  return counts;
}
