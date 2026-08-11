/**
 * V6 repository scanner — AST symbols (spans) + structural dependencies.
 */
import fs from "fs";
import path from "path";
import { nodeIdForPath } from "../repo-graph.mjs";
import { loadRetrievalConfig } from "../paths.mjs";
import {
  extractImportSpecs,
  loadPathAliases,
  loadWorkspacePackages,
  resolveImportPath,
  walkCodeFiles,
} from "./files.mjs";
import { buildCallEdgesForFile } from "./calls.mjs";
import { extractSymbolsForFile } from "./symbols.mjs";

function readText(file, maxChars = 200_000) {
  try {
    return fs.readFileSync(file, "utf8").slice(0, maxChars);
  } catch {
    return "";
  }
}

function detectKind(relativePath) {
  return /(^|\/)(__tests__|tests?|e2e)\//.test(relativePath) ||
    /\.(test|spec)\.[^.]+$/.test(relativePath)
    ? "test"
    : "file";
}

/** Regex name fallback when AST unavailable for a language. */
function extractSymbolNamesRegex(source) {
  const symbols = new Set();
  const patterns = [
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g,
    /^\s*def\s+([A-Za-z_][\w]*)\s*\(/gm,
    /^\s*class\s+([A-Za-z_][\w]*)\s*[:(]/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) symbols.add(match[1]);
  }
  return [...symbols].slice(0, 80);
}

function summarizeFile(relativePath, source, symbolNames) {
  const firstComment = source.match(
    /(?:\/\*\*?([\s\S]*?)\*\/|^\s*\/\/\s*(.+)$|^\s*#\s*(.+)$)/m,
  );
  const comment = firstComment
    ? String(firstComment[1] || firstComment[2] || firstComment[3] || "")
        .replace(/\s*\*\s?/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240)
    : "";
  const symbolSummary = symbolNames.length
    ? `Exports/symbols: ${symbolNames.slice(0, 12).join(", ")}`
    : "";
  return [relativePath, comment, symbolSummary].filter(Boolean).join(" — ").slice(0, 500);
}

/**
 * Scan workspace files into graph nodes/edges + AST symbol records.
 * @returns {Promise<{ root: string, files: string[], nodes: object[], edges: object[], symbols: object[] }>}
 */
export async function scanWorkspace(options = {}) {
  const root = options.root || process.env.AAAC_WORKSPACE_ROOT || process.cwd();
  const maxFiles = Number(
    options.maxFiles ?? loadRetrievalConfig().repo_memory?.index_max_files ?? 4000,
  );
  const files = walkCodeFiles(root, maxFiles);
  const fileSet = new Set(files);
  const aliases = loadPathAliases(root);
  const workspacePackages = loadWorkspacePackages(root);
  const nodes = [];
  const edges = [];
  const symbols = [];

  for (const relativePath of files) {
    const source = readText(path.join(root, relativePath));
    const id = nodeIdForPath(relativePath);
    const kind = detectKind(relativePath);

    const astSymbols = await extractSymbolsForFile({
      path: relativePath,
      source,
      fileNodeId: id,
    });
    const symbolNames = astSymbols.length
      ? astSymbols.map((s) => s.name)
      : extractSymbolNamesRegex(source);

    nodes.push({
      id,
      kind,
      path: relativePath,
      summary: summarizeFile(relativePath, source, symbolNames),
      api: symbolNames.join(", "),
      source_files: [relativePath],
      tags: [kind, path.extname(relativePath).slice(1)].filter(Boolean),
      confidence: 0.8,
    });
    symbols.push(...astSymbols);

    for (const spec of extractImportSpecs(source)) {
      const target = resolveImportPath(
        relativePath,
        spec,
        root,
        aliases,
        workspacePackages,
      );
      if (!target || target === relativePath || !fileSet.has(target)) continue;
      const targetId = nodeIdForPath(target);
      const directKind = kind === "test" ? "tests" : "imports";
      const reverseKind = kind === "test" ? "tested_by" : "imported_by";
      edges.push({ from: id, to: targetId, kind: directKind, weight: 1 });
      edges.push({ from: targetId, to: id, kind: reverseKind, weight: 1 });
    }

    const callEdges = buildCallEdgesForFile({
      fromId: id,
      source,
      fileSet,
      nodeIdForPath,
      resolveSpec: (spec) =>
        resolveImportPath(relativePath, spec, root, aliases, workspacePackages),
    });
    edges.push(...callEdges);
  }

  return { root, files, nodes, edges, symbols };
}
