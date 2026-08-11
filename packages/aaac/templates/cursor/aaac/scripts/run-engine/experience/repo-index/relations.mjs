/**
 * Index-time relational answers: blast-radius, clusters, entry flows.
 * Structural import/test edges only (ignores semantic `related` glue).
 */
import path from "path";
import { isoNow } from "../../lib.mjs";
import { loadRetrievalConfig } from "../paths.mjs";

export const STRUCTURAL_EDGE_KINDS = new Set([
  "imports",
  "imported_by",
  "tests",
  "tested_by",
  "calls",
  "called_by",
]);

/** Reverse-dep kinds: who depends on this node. */
export const BLAST_EDGE_KINDS = new Set(["imported_by", "tested_by", "called_by"]);

/** Forward import kinds: what this node pulls in. */
export const IMPORT_EDGE_KINDS = new Set(["imports", "tests"]);

/** Forward call kinds. */
export const CALL_EDGE_KINDS = new Set(["calls"]);

const ENTRY_BASENAME_RE =
  /^(main|index|app|server|cli|route|routes|router|bootstrap|entrypoint)(\.[^.]+)?$/i;
const ENTRY_DIR_RE = /(^|\/)(bin|cli|routes?|pages?|app|server)(\/|$)/i;
const ENTRY_PATH_RE = /(^|\/)(main|index|app|server|cli)\.[a-z0-9]+$/i;

export const DEFAULT_RELATIONS_CFG = {
  blast_depth: 3,
  blast_cap: 40,
  flow_max_hops: 6,
  relations_max_impact: 12,
  relations_max_flows: 8,
  relations_max_clusters: 8,
};

/**
 * @param {object} [rm]
 */
export function relationsConfig(rm = {}) {
  return {
    blast_depth: rm.blast_depth ?? DEFAULT_RELATIONS_CFG.blast_depth,
    blast_cap: rm.blast_cap ?? DEFAULT_RELATIONS_CFG.blast_cap,
    flow_max_hops: rm.flow_max_hops ?? DEFAULT_RELATIONS_CFG.flow_max_hops,
    relations_max_impact:
      rm.relations_max_impact ?? DEFAULT_RELATIONS_CFG.relations_max_impact,
    relations_max_flows:
      rm.relations_max_flows ?? DEFAULT_RELATIONS_CFG.relations_max_flows,
    relations_max_clusters:
      rm.relations_max_clusters ?? DEFAULT_RELATIONS_CFG.relations_max_clusters,
  };
}

export function emptyRelations() {
  return {
    updated_at: null,
    clusters: {},
    entries: [],
  };
}

/**
 * @param {object} node
 */
export function isEntryNode(node) {
  if (!node || (node.kind !== "file" && node.kind !== "test" && node.kind !== "module")) {
    return false;
  }
  const rel = String(node.path ?? "").replace(/\\/g, "/");
  if (!rel) return false;
  const base = path.posix.basename(rel);
  if (ENTRY_BASENAME_RE.test(base)) return true;
  if (ENTRY_PATH_RE.test(rel)) return true;
  if (ENTRY_DIR_RE.test(rel) && /\.(m?js|cjs|ts|tsx|jsx|mjs)$/i.test(base)) return true;
  return false;
}

/**
 * @param {object} graph
 * @param {Set<string>} kinds
 * @returns {Map<string, string[]>}
 */
function adjacency(graph, kinds) {
  const map = new Map();
  for (const e of graph.edges ?? []) {
    if (!kinds.has(e.kind)) continue;
    if (!map.has(e.from)) map.set(e.from, []);
    map.get(e.from).push(e.to);
  }
  return map;
}

/**
 * Undirected structural neighbors for clustering.
 * @param {object} graph
 */
function undirectedStructural(graph) {
  const map = new Map();
  const add = (a, b) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a).add(b);
  };
  for (const e of graph.edges ?? []) {
    if (!STRUCTURAL_EDGE_KINDS.has(e.kind)) continue;
    add(e.from, e.to);
    add(e.to, e.from);
  }
  return map;
}

/**
 * @param {Map<string, string[]>} adj
 * @param {string} start
 * @param {number} depth
 * @param {number} cap
 */
function bfsClosure(adj, start, depth, cap) {
  const seen = new Set();
  const queue = [{ id: start, d: 0 }];
  const ordered = [];
  while (queue.length && ordered.length < cap) {
    const { id, d } = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    if (id !== start) {
      ordered.push(id);
      if (ordered.length >= cap) break;
    }
    if (d >= depth) continue;
    for (const next of adj.get(id) ?? []) {
      if (!seen.has(next)) queue.push({ id: next, d: d + 1 });
    }
  }
  return ordered;
}

/**
 * Connected components over structural file/test nodes.
 * @param {object} graph
 * @param {Map<string, Set<string>>} undirected
 */
function computeClusters(graph, undirected) {
  const nodes = Object.values(graph.nodes ?? {}).filter(
    (n) => n.kind === "file" || n.kind === "test" || n.kind === "module",
  );
  const visited = new Set();
  const clusters = {};
  let idx = 0;

  for (const node of nodes.sort((a, b) => a.id.localeCompare(b.id))) {
    if (visited.has(node.id)) continue;
    const members = [];
    const stack = [node.id];
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const n = graph.nodes[id];
      if (!n || (n.kind !== "file" && n.kind !== "test" && n.kind !== "module")) {
        continue;
      }
      members.push(id);
      for (const nb of undirected.get(id) ?? []) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    members.sort();
    const clusterId = `c${idx}`;
    idx += 1;
    const paths = members
      .map((id) => graph.nodes[id]?.path)
      .filter(Boolean)
      .map((p) => String(p).replace(/\\/g, "/"));
    const label = dominantDirectoryLabel(paths) || clusterId;
    clusters[clusterId] = {
      id: clusterId,
      label,
      size: members.length,
      sample_paths: paths.slice(0, 8),
      member_ids: members,
    };
  }
  return clusters;
}

/**
 * @param {string[]} paths
 */
function dominantDirectoryLabel(paths) {
  if (!paths.length) return null;
  const counts = new Map();
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    let key = "root";
    if (
      (parts[0] === "apps" || parts[0] === "packages" || parts[0] === "services") &&
      parts[1]
    ) {
      key = parts.length > 2 ? `${parts[0]}/${parts[1]}/${parts[2]}` : `${parts[0]}/${parts[1]}`;
    } else if (parts.length >= 2) {
      key = `${parts[0]}/${parts[1]}`;
    } else if (parts[0]) {
      key = parts[0];
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/**
 * Shortest path from any entry to target along reverse imports
 * (walk imported_by from target toward entries = walk imports from entry to target).
 * @param {object} graph
 * @param {string[]} entryIds
 * @param {string} targetId
 * @param {number} maxHops
 * @returns {{ entry: string, chain: string[] } | null}
 */
export function shortestEntryFlow(graph, entryIds, targetId, maxHops) {
  if (!entryIds?.length || !targetId) return null;
  const entrySet = new Set(entryIds);
  if (entrySet.has(targetId)) {
    const p = graph.nodes[targetId]?.path;
    return { entry: p || targetId, chain: [p || targetId].filter(Boolean) };
  }

  // Walk reverse: from target via `imports` edges' reverse = follow who target imports? 
  // Entry → … → target means edges imports: entry→dep. So from target walk imported_by reverse? 
  // Edge imports: from=importer to=importee. Flow entry imports A imports target:
  // entry --imports--> A --imports--> target.
  // BFS backward from target along edges where kind=imports and e.to === current → e.from
  const parents = new Map();
  const queue = [{ id: targetId, depth: 0 }];
  const seen = new Set([targetId]);
  let foundEntry = null;

  while (queue.length) {
    const { id: cur, depth } = queue.shift();
    if (depth >= maxHops) continue;

    for (const e of graph.edges ?? []) {
      if (!IMPORT_EDGE_KINDS.has(e.kind)) continue;
      // importer e.from imports e.to; predecessor toward entry is e.from
      if (e.to !== cur) continue;
      const pred = e.from;
      if (seen.has(pred)) continue;
      seen.add(pred);
      parents.set(pred, cur);
      if (entrySet.has(pred)) {
        foundEntry = pred;
        queue.length = 0;
        break;
      }
      queue.push({ id: pred, depth: depth + 1 });
    }
  }

  if (!foundEntry) return null;
  const ids = [foundEntry];
  let cur = foundEntry;
  while (parents.has(cur) && ids.length <= maxHops + 1) {
    cur = parents.get(cur);
    ids.push(cur);
    if (cur === targetId) break;
  }
  const chain = ids
    .map((id) => graph.nodes[id]?.path || id)
    .filter(Boolean);
  const entryPath = graph.nodes[foundEntry]?.path || foundEntry;
  return { entry: entryPath, chain };
}

/**
 * @param {object} graph
 * @returns {boolean}
 */
export function needsRelationsUpgrade(graph) {
  const fileNodes = Object.values(graph.nodes ?? {}).filter(
    (n) => n.kind === "file" || n.kind === "test",
  );
  if (!fileNodes.length) return false;
  return fileNodes.some((n) => n.cluster_id == null);
}

/**
 * Compute and write relational answers onto the graph (mutates).
 * @param {object} graph
 * @param {object} [options]
 */
export function computeRepoRelations(graph, options = {}) {
  const cfg = relationsConfig(options.cfg ?? loadRetrievalConfig().repo_memory ?? {});
  const blastAdj = adjacency(graph, BLAST_EDGE_KINDS);
  const undirected = undirectedStructural(graph);
  const clusters = computeClusters(graph, undirected);

  const memberToCluster = new Map();
  for (const c of Object.values(clusters)) {
    for (const id of c.member_ids) memberToCluster.set(id, c.id);
  }

  const entries = [];
  let blastSum = 0;
  let blastCount = 0;

  for (const node of Object.values(graph.nodes ?? {})) {
    if (node.kind !== "file" && node.kind !== "test" && node.kind !== "module") {
      delete node.fan_in;
      delete node.fan_out;
      delete node.blast_score;
      delete node.blast_dependents;
      delete node.cluster_id;
      delete node.is_entry;
      continue;
    }

    // Count only forward structural edges to avoid double-counting reverse pairs.
    let fanIn = 0;
    let fanOut = 0;
    for (const e of graph.edges ?? []) {
      if (e.kind === "imports" || e.kind === "tests") {
        if (e.from === node.id) fanOut += 1;
        if (e.to === node.id) fanIn += 1;
      }
    }

    let dependents = bfsClosure(blastAdj, node.id, cfg.blast_depth, cfg.blast_cap);
    // Fallback when reverse edges were not materialized.
    if (!dependents.length && !(blastAdj.get(node.id)?.length)) {
      const reverse = new Map();
      for (const e of graph.edges ?? []) {
        if (e.kind !== "imports" && e.kind !== "tests") continue;
        if (!reverse.has(e.to)) reverse.set(e.to, []);
        reverse.get(e.to).push(e.from);
      }
      dependents = bfsClosure(reverse, node.id, cfg.blast_depth, cfg.blast_cap);
    }

    const blastDependents = dependents
      .map((id) => graph.nodes[id]?.path)
      .filter(Boolean)
      .slice(0, cfg.blast_cap);

    const entry = isEntryNode(node);
    if (entry) entries.push(node.id);

    node.fan_in = fanIn;
    node.fan_out = fanOut;
    node.blast_score = blastDependents.length;
    node.blast_dependents = blastDependents;
    node.cluster_id = memberToCluster.get(node.id) ?? null;
    node.is_entry = entry;

    blastSum += node.blast_score;
    blastCount += 1;
  }

  entries.sort();
  const publicClusters = {};
  for (const [id, c] of Object.entries(clusters)) {
    publicClusters[id] = {
      id: c.id,
      label: c.label,
      size: c.size,
      sample_paths: c.sample_paths,
    };
  }

  graph.relations = {
    updated_at: isoNow(),
    clusters: publicClusters,
    entries,
  };

  return {
    clusters: Object.keys(publicClusters).length,
    entries: entries.length,
    avg_blast: blastCount ? Math.round((blastSum / blastCount) * 100) / 100 : 0,
    nodes: blastCount,
  };
}

/**
 * Build retrieve-packet relational slices for focus nodes.
 * @param {object} graph
 * @param {object[]} picked — { nodeId, node }
 * @param {object} [rmCfg]
 */
export function relationsForPacket(graph, picked, rmCfg = {}) {
  const cfg = relationsConfig(rmCfg);
  const relations = graph.relations ?? emptyRelations();
  const entryIds = relations.entries ?? [];

  const impact = [];
  for (const c of picked) {
    const n = c.node;
    if (!n?.path) continue;
    impact.push({
      path: n.path,
      fan_in: n.fan_in ?? 0,
      fan_out: n.fan_out ?? 0,
      blast_score: n.blast_score ?? 0,
      top_dependents: (n.blast_dependents ?? []).slice(0, 8),
    });
    if (impact.length >= cfg.relations_max_impact) break;
  }

  const entry_flows = [];
  const seenFlow = new Set();
  for (const c of picked) {
    if (entry_flows.length >= cfg.relations_max_flows) break;
    const flow = shortestEntryFlow(
      graph,
      entryIds,
      c.nodeId,
      cfg.flow_max_hops,
    );
    if (!flow) continue;
    const key = `${flow.entry}->${c.node.path}`;
    if (seenFlow.has(key)) continue;
    seenFlow.add(key);
    entry_flows.push({
      entry: flow.entry,
      target: c.node.path,
      chain: flow.chain,
    });
  }

  const clusterMap = new Map();
  for (const c of picked) {
    const cid = c.node?.cluster_id;
    if (!cid) continue;
    const meta = relations.clusters?.[cid] ?? { id: cid, label: cid, size: 0 };
    if (!clusterMap.has(cid)) {
      clusterMap.set(cid, {
        id: cid,
        label: meta.label ?? cid,
        size: meta.size ?? 0,
        focus_paths: [],
      });
    }
    if (c.node.path) clusterMap.get(cid).focus_paths.push(c.node.path);
  }
  const clusters = [...clusterMap.values()].slice(0, cfg.relations_max_clusters);

  const call_neighbors = [];
  for (const c of picked) {
    if (!c.node?.path) continue;
    const callees = [];
    const callers = [];
    for (const e of graph.edges ?? []) {
      if (e.kind === "calls" && e.from === c.nodeId) {
        const p = graph.nodes[e.to]?.path;
        if (p) callees.push(p);
      }
      if (e.kind === "called_by" && e.from === c.nodeId) {
        const p = graph.nodes[e.to]?.path;
        if (p) callers.push(p);
      }
    }
    if (!callees.length && !callers.length) continue;
    call_neighbors.push({
      path: c.node.path,
      callees: [...new Set(callees)].slice(0, 8),
      callers: [...new Set(callers)].slice(0, 8),
    });
    if (call_neighbors.length >= cfg.relations_max_impact) break;
  }

  return { impact, entry_flows, clusters, call_neighbors };
}
