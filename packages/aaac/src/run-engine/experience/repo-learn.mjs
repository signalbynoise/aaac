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
 * Learn verified retrieval_miss → path mappings into the durable graph.
 * Only persists resolutions that intersect confirmed/new_findings or paths_touched.
 *
 * @param {object} graph
 * @param {{
 *   trajectory: object,
 *   manifest: object,
 *   artifactsDir?: string|null,
 * }} input
 * @returns {{
 *   learned: Array<{ sought: string, paths: string[] }>,
 *   skipped: Array<{ sought: string, reason: string }>,
 *   added_nodes: string[],
 * }}
 */
export function learnFromRetrievalMisses(graph, {
  trajectory,
  manifest,
  artifactsDir = null,
}) {
  const learned = [];
  const skipped = [];
  const added_nodes = [];

  if (!trajectory?.quality?.ok) {
    return { learned, skipped: [{ sought: "*", reason: "quality_not_ok" }], added_nodes };
  }
  if (!artifactsDir || !fs.existsSync(artifactsDir)) {
    return { learned, skipped: [{ sought: "*", reason: "no_artifacts" }], added_nodes };
  }

  const missStore = (() => {
    try {
      const p = path.join(artifactsDir, "retrieval_misses.json");
      if (!fs.existsSync(p)) return { misses: [] };
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return { misses: [] };
    }
  })();
  const heal = (() => {
    try {
      const p = path.join(artifactsDir, "retrieval_heal.json");
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  })();

  const misses = Array.isArray(missStore.misses) ? missStore.misses : [];
  if (!misses.length && !(heal?.resolved_paths?.length)) {
    return { learned, skipped: [{ sought: "*", reason: "no_misses" }], added_nodes };
  }

  const confirmed = new Set();
  const briefYaml = readArtifactText(artifactsDir, "discover_brief.yaml");
  for (const p of extractYamlPathList(briefYaml, "confirmed")) confirmed.add(p.replace(/\\/g, "/"));
  for (const p of extractYamlPathList(briefYaml, "new_findings")) confirmed.add(p.replace(/\\/g, "/"));
  for (const p of trajectory.paths_touched ?? trajectory.focus_paths ?? []) {
    if (typeof p === "string") confirmed.add(p.replace(/\\/g, "/"));
  }

  const soughtTerms = [
    ...new Set([
      ...misses.map((m) => String(m.sought ?? "").trim()).filter(Boolean),
      ...(Array.isArray(heal?.sought_terms) ? heal.sought_terms : []),
    ]),
  ];
  const bySought = heal?.by_sought && typeof heal.by_sought === "object" ? heal.by_sought : {};
  const defaultResolved = (heal?.resolved_paths ?? []).map((p) => String(p).replace(/\\/g, "/"));

  for (const sought of soughtTerms) {
    const candidates = [
      ...new Set([
        ...(bySought[sought] ?? []).map((p) => String(p).replace(/\\/g, "/")),
        ...defaultResolved,
      ]),
    ].filter(Boolean);

    if (!candidates.length) {
      skipped.push({ sought, reason: "empty_expand" });
      continue;
    }

    const verified = candidates.filter((p) => confirmed.has(p));
    if (!verified.length) {
      skipped.push({ sought, reason: "unconfirmed" });
      continue;
    }

    const aliasTokens = tokenizeSought(sought);
    for (const rel of verified.slice(0, 8)) {
      const id = nodeIdForPath(rel);
      const prev = graph.nodes[id];
      const tags = [
        ...new Set([
          ...(prev?.tags ?? []),
          "learned",
          "retrieval_alias",
          manifest?.object,
          ...aliasTokens.slice(0, 6),
        ].filter(Boolean)),
      ];
      const triggerBits = [
        prev?.trigger,
        sought,
        manifest?.intent ? String(manifest.intent).slice(0, 120) : "",
        manifest?.object ?? "",
      ]
        .filter(Boolean)
        .join(" ");
      upsertNode(graph, {
        id,
        kind: prev?.kind ?? (/\.(test|spec)\./i.test(rel) ? "test" : "file"),
        path: rel,
        trigger: triggerBits.slice(0, 400),
        summary:
          prev?.summary && !/^Learned focus path from successful/i.test(prev.summary)
            ? prev.summary
            : `Retrieval alias for "${sought}": ${path.basename(rel)}`,
        source_files: [rel],
        confidence: Math.max(prev?.confidence ?? 0, 0.75),
        tags,
      });
      if (graph.nodes[id]) {
        graph.nodes[id].hits = (graph.nodes[id].hits ?? 0) + 1;
      }
      added_nodes.push(id);
    }

    const invId = invariantId(
      `retrieval-alias-${sought.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`,
    );
    upsertNode(graph, {
      id: invId,
      kind: "invariant",
      claim: `When seeking "${sought}", start at: ${verified.slice(0, 4).join(", ")}`,
      summary: `Retrieval alias: ${sought}`,
      trigger: `sought ${sought} ${manifest?.object ?? ""} ${manifest?.intent ?? ""}`.slice(0, 400),
      source_files: verified.slice(0, 5),
      confidence: 0.7,
      tags: ["invariant", "retrieval_alias", "learned"],
    });
    added_nodes.push(invId);

    learned.push({ sought, paths: verified });
  }

  return {
    learned,
    skipped,
    added_nodes: [...new Set(added_nodes)],
  };
}

function tokenizeSought(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_./+-]+/)
    .filter((t) => t.length > 2)
    .slice(0, 12);
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
    const missLearn = learnFromRetrievalMisses(graph, {
      trajectory,
      manifest,
      artifactsDir,
    });
    saveRepoGraph(graph);

    if (artifactsDir) {
      try {
        writeJsonSafe(path.join(artifactsDir, "retrieval-miss-learn.json"), {
          run_id: manifest?.run_id ?? null,
          prepared_at: new Date().toISOString(),
          learned: missLearn.learned,
          skipped: missLearn.skipped,
          added_nodes: missLearn.added_nodes,
        });
      } catch {
        // optional telemetry
      }
    }

    const pad = loadRepoScratchpad();
    const focusIds = learn.added_nodes.length
      ? learn.added_nodes
      : missLearn.added_nodes;
    if (focusIds.length) {
      const aliasNote = missLearn.learned.length
        ? ` Miss aliases: ${missLearn.learned
            .slice(0, 4)
            .map((l) => `"${l.sought}"→${l.paths.slice(0, 2).join("|")}`)
            .join("; ")}`
        : "";
      mergeScratchpadNote(pad, {
        id: `run-${manifest?.run_id ?? Date.now()}`,
        text: `Run ${manifest?.command ?? ""} focused ${focusIds
          .filter((id) => id.startsWith("file:"))
          .slice(0, 8)
          .map((id) => id.slice(5))
          .join(", ")}${aliasNote}`,
        tags: ["run", "retrieval_alias", manifest?.command].filter(Boolean),
      });
      saveRepoScratchpad(pad);
      writeRepoMapFromScratchpad(pad);
    }

    const upsertIds = [
      ...new Set([...learn.added_nodes, ...missLearn.added_nodes]),
    ];
    const indexResult = await upsertRepoNodesIntoIndex(graph, {
      nodeIds: upsertIds.length ? upsertIds : undefined,
    });

    const detail = {
      added_nodes: learn.added_nodes.length,
      added_edges: learn.added_edges,
      miss_learned: missLearn.learned.length,
      miss_skipped: missLearn.skipped.length,
      upserted: indexResult.upserted,
    };
    if (emit) {
      emitRepoMemoryEvent({ phase: "learn_done", detail });
    }
    return {
      ok: true,
      ...detail,
      index: indexResult,
      miss_learn: missLearn,
    };
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

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
