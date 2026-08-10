/**
 * V6 — Lightweight scoped filesystem scan + import edge heuristics.
 */
import fs from "fs";
import path from "path";
import { loadRetrievalConfig } from "../paths.mjs";
import { resolveWorkspaceRoot } from "../repo-graph.mjs";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  "coverage",
  ".next",
  "release",
  ".cursor",
  ".turbo",
  "playwright-report",
]);

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
]);

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

/**
 * @param {string} root
 * @param {number} maxFiles
 * @returns {string[]} relative paths
 */
export function walkCodeFiles(root, maxFiles = 400) {
  const out = [];
  function walk(dir) {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!shouldSkipDir(ent.name)) walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!CODE_EXT.has(ext)) continue;
      out.push(path.relative(root, abs).replace(/\\/g, "/"));
    }
  }
  walk(root);
  return out;
}

/**
 * Extract relative import/require targets from source text.
 */
export function extractImportSpecs(source) {
  const specs = [];
  const re =
    /(?:import\s+(?:type\s+)?(?:[^'"\n]+?\s+from\s+)?|export\s+(?:type\s+)?[^'"\n]*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source))) {
    specs.push(m[1]);
  }
  return [...new Set(specs)];
}

/**
 * Resolve a relative import to a repo-relative path if possible.
 */
export function resolveImportPath(fromRel, spec, root) {
  if (!spec.startsWith(".")) return null;
  const fromDir = path.dirname(fromRel);
  const base = path.normalize(path.join(fromDir, spec)).replace(/\\/g, "/");
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.jsx`,
    path.join(base, "index.ts").replace(/\\/g, "/"),
    path.join(base, "index.tsx").replace(/\\/g, "/"),
    path.join(base, "index.js").replace(/\\/g, "/"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(root, c))) return c.replace(/\\/g, "/");
  }
  return null;
}

function summarizeFile(rel, source) {
  const exports = [];
  const exportRe =
    /export\s+(?:async\s+)?(?:function|class|const|type|interface|enum)\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = exportRe.exec(source)) && exports.length < 12) {
    exports.push(m[1]);
  }
  const lines = source.split("\n").length;
  const kind = /\.(test|spec)\./i.test(rel) || /\/tests?\//i.test(rel)
    ? "test"
    : rel.includes("package.json")
      ? "module"
      : "file";
  const summary = `${kind} ${rel} (~${lines} lines)${
    exports.length ? `; exports: ${exports.slice(0, 8).join(", ")}` : ""
  }`;
  return {
    kind,
    summary,
    api: exports.join(", "),
    trigger: `${path.basename(rel)} ${exports.slice(0, 6).join(" ")}`,
  };
}

/**
 * Scan workspace into node/edge descriptors (not yet persisted).
 */
export function scanWorkspace(options = {}) {
  const root = options.root ?? resolveWorkspaceRoot();
  const cfg = loadRetrievalConfig();
  const maxFiles = options.maxFiles ?? cfg.repo_memory?.index_max_files ?? 400;
  const files = walkCodeFiles(root, maxFiles);
  const nodes = [];
  const edges = [];

  for (const rel of files) {
    let source = "";
    try {
      source = fs.readFileSync(path.join(root, rel), "utf8").slice(0, 120_000);
    } catch {
      continue;
    }
    const meta = summarizeFile(rel, source);
    const id = `file:${rel}`;
    nodes.push({
      id,
      kind: meta.kind,
      path: rel,
      summary: meta.summary,
      api: meta.api,
      trigger: meta.trigger,
      source_files: [rel],
      confidence: 0.55,
      tags: [meta.kind, path.extname(rel).slice(1)].filter(Boolean),
    });

    for (const spec of extractImportSpecs(source)) {
      const target = resolveImportPath(rel, spec, root);
      if (!target) continue;
      const toId = `file:${target}`;
      edges.push({ from: id, to: toId, kind: "imports", weight: 1 });
      edges.push({ from: toId, to: id, kind: "imported_by", weight: 1 });
    }

    if (meta.kind === "test") {
      const guess = rel
        .replace(/\.(test|spec)\./i, ".")
        .replace(/\/tests?\//, "/")
        .replace(/\.test\./, ".");
      for (const candidate of [guess, guess.replace(/\/__tests__\//, "/")]) {
        const norm = candidate.replace(/\\/g, "/");
        if (norm !== rel && fs.existsSync(path.join(root, norm))) {
          const toId = `file:${norm}`;
          edges.push({ from: id, to: toId, kind: "tests", weight: 1 });
          edges.push({ from: toId, to: id, kind: "tested_by", weight: 1 });
        }
      }
    }
  }

  return { root, files, nodes, edges, maxFiles };
}
