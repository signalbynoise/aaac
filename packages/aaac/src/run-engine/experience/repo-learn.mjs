/**
 * V6 — Learn repo graph / invariants / scratchpad from quality-ok runs.
 */
import fs from "fs";
import path from "path";
import {
  loadRepoGraph,
  saveRepoGraph,
  upsertNode,
  upsertEdge,
  nodeIdForPath,
  invariantId,
  resolveWorkspaceRoot,
} from "./repo-graph.mjs";
import {
  loadRepoScratchpad,
  saveRepoScratchpad,
  mergeScratchpadNote,
  writeRepoMapFromScratchpad,
} from "./repo-scratchpad.mjs";
import { upsertRepoNodesIntoIndex } from "./repo-index/build.mjs";
import { emitRepoMemoryEvent } from "./repo-events.mjs";

function extractPathsFromText(text) {
  if (!text) return [];
  const re =
    /(?:^|[\s`"'(])((?:apps|packages|src|tests?|\.cursor)\/[A-Za-z0-9_./+-]+\.[A-Za-z0-9]+)(?=[\s`"'`),:]|$)/gm;
  const out = [];
  let m;
  while ((m = re.exec(String(text)))) {
    out.push(m[1].replace(/\\/g, "/"));
  }
  return [...new Set(out)];
}

function readArtifactText(artifactsDir, name) {
  try {
    const p = path.join(artifactsDir, name);
    if (!fs.existsSync(p)) return "";
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** Parse YAML list block under a key (confirmed/stale/new_findings). */
function extractYamlPathList(content, key) {
  if (!content) return [];
  const re = new RegExp(
    `^${key}:\\s*(?:\\[\\]|\\n((?:\\s+-\\s+[^\\n]+\\n?)+))`,
    "m",
  );
  const m = content.match(re);
  if (!m) return [];
  if (!m[1]) return [];
  const out = [];
  for (const line of m[1].split("\n")) {
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!item) continue;
    const val = item[1].replace(/^["']|["']$/g, "").trim();
    if (val && /[./]/.test(val)) out.push(val.replace(/\\/g, "/"));
  }
  return [...new Set(out)];
}

/**
 * @param {object} graph
 * @param {{ trajectory: object, manifest: object, artifactsDir?: string, lessons?: object[] }} input
 */
export function learnRepoGraphFromRun(graph, {
  trajectory,
  manifest,
  artifactsDir = null,
  lessons = [],
}) {
  if (!trajectory?.quality?.ok) return { added_nodes: [], added_edges: 0 };

  const added_nodes = [];
  let added_edges = 0;
  const root = resolveWorkspaceRoot();
  const paths = new Set();

  for (const p of trajectory.paths_touched ?? trajectory.focus_paths ?? []) {
    if (typeof p === "string") paths.add(p.replace(/\\/g, "/"));
  }

  if (artifactsDir) {
    const briefYaml = readArtifactText(artifactsDir, "discover_brief.yaml");
    for (const p of extractYamlPathList(briefYaml, "confirmed")) paths.add(p);
    for (const p of extractYamlPathList(briefYaml, "new_findings")) paths.add(p);
    for (const p of extractYamlPathList(briefYaml, "stale")) {
      const id = nodeIdForPath(p);
      if (graph.nodes[id]) {
        graph.nodes[id].valid = false;
        graph.nodes[id].tags = [
          ...new Set([...(graph.nodes[id].tags ?? []), "stale"]),
        ];
      }
    }
    for (const name of [
      "discover_brief.yaml",
      "discover-brief.md",
      "discovery-brief.md",
      "investigation.md",
    ]) {
      const text = readArtifactText(artifactsDir, name);
      for (const p of extractPathsFromText(text)) paths.add(p);
    }
  }

  const pathList = [...paths].slice(0, 40);
  for (const rel of pathList) {
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const id = nodeIdForPath(rel);
    const kind = /\.(test|spec)\./i.test(rel) ? "test" : "file";
    const prev = graph.nodes[id];
    // Never overwrite scanned summary/api — that collapses dense Stage-1 recall.
    const patch = {
      id,
      kind: prev?.kind ?? kind,
      path: rel,
      trigger: prev?.trigger || `${manifest?.command ?? ""} ${rel}`,
      source_files: [rel],
      confidence: 0.7,
      tags: [
        ...new Set([...(prev?.tags ?? []), "learned", "focus", manifest?.object].filter(Boolean)),
      ],
    };
    if (!prev?.summary || /^Learned focus path from successful/i.test(prev.summary)) {
      // Heal poisoned boilerplate; leave empty so next index scan can refill.
      patch.summary = prev?.api
        ? `Exports/symbols: ${String(prev.api).slice(0, 200)}`
        : `Focus path: ${path.basename(rel)}`;
    }
    upsertNode(graph, patch);
    if (graph.nodes[id]) {
      graph.nodes[id].hits = (graph.nodes[id].hits ?? 0) + 1;
    }
    added_nodes.push(id);
  }

  for (let i = 0; i < pathList.length; i += 1) {
    for (let j = i + 1; j < Math.min(pathList.length, i + 4); j += 1) {
      const a = nodeIdForPath(pathList[i]);
      const b = nodeIdForPath(pathList[j]);
      if (graph.nodes[a] && graph.nodes[b]) {
        upsertEdge(graph, a, b, "related", 0.8);
        upsertEdge(graph, b, a, "related", 0.8);
        added_edges += 2;
      }
    }
  }

  for (const lesson of lessons) {
    for (const p of lesson.avoid_paths ?? []) {
      const id = `claim:skip-${p.replace(/[^a-zA-Z0-9._/-]+/g, "-").slice(0, 60)}`;
      upsertNode(graph, {
        id,
        kind: "claim",
        path: null,
        claim: `Usually skip ${p} unless required.`,
        summary: `Skip ${p}`,
        trigger: `skip ${p}`,
        source_files: [],
        confidence: 0.55,
        tags: ["skip", "claim"],
      });
      added_nodes.push(id);
    }
  }

  if (artifactsDir) {
    const brief =
      readArtifactText(artifactsDir, "discover_brief.yaml")
      || readArtifactText(artifactsDir, "discovery-brief.md");
    const ownerMatch = brief.match(/owns?\s+state[:\s]+([^\n]+)/i);
    if (ownerMatch) {
      const id = invariantId(`ssot-${manifest?.object ?? "module"}`);
      const focus = pathList.slice(0, 5);
      upsertNode(graph, {
        id,
        kind: "invariant",
        claim: `SSOT: ${ownerMatch[1].trim()}`,
        summary: `SSOT: ${ownerMatch[1].trim()}`,
        trigger: `ssot ${manifest?.object ?? ""} ownership`,
        source_files: focus,
        confidence: 0.65,
        tags: ["invariant", "ssot"],
      });
      added_nodes.push(id);
    }
  }

  return { added_nodes: [...new Set(added_nodes)], added_edges };
}

/**
 * Full post-run repo memory update.
 */
export async function processRepoMemoryFromRun({
  trajectory,
  manifest,
  artifactsDir,
  lessons = [],
  emit = true,
}) {
  if (!trajectory?.quality?.ok) {
    return { ok: false, skipped: true, reason: "quality_not_ok" };
  }

  try {
    const graph = loadRepoGraph();
    const learn = learnRepoGraphFromRun(graph, {
      trajectory,
      manifest,
      artifactsDir,
      lessons,
    });
    saveRepoGraph(graph);

    const pad = loadRepoScratchpad();
    if (learn.added_nodes.length) {
      mergeScratchpadNote(pad, {
        id: `run-${manifest?.run_id ?? Date.now()}`,
        text: `Run ${manifest?.command ?? ""} focused ${learn.added_nodes
          .filter((id) => id.startsWith("file:"))
          .slice(0, 8)
          .map((id) => id.slice(5))
          .join(", ")}`,
        tags: ["run", manifest?.command].filter(Boolean),
      });
      saveRepoScratchpad(pad);
      writeRepoMapFromScratchpad(pad);
    }

    const indexResult = await upsertRepoNodesIntoIndex(graph, {
      nodeIds: learn.added_nodes.length ? learn.added_nodes : undefined,
    });

    const detail = {
      added_nodes: learn.added_nodes.length,
      added_edges: learn.added_edges,
      upserted: indexResult.upserted,
    };
    if (emit) {
      emitRepoMemoryEvent({ phase: "learn_done", detail });
    }
    return { ok: true, ...detail, index: indexResult };
  } catch (err) {
    const detail = { error: String(err?.message ?? err).slice(0, 300) };
    if (emit) {
      emitRepoMemoryEvent({
        phase: "error",
        level: "error",
        detail: { ...detail, where: "learn" },
      });
    }
    return { ok: false, ...detail };
  }
}
