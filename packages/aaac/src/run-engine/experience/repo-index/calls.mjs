/**
 * Static call-graph heuristics (file-level).
 * Resolve calls through import bindings → callee files.
 * No Tree-sitter — deterministic regex good enough for agent focus.
 */

const CALL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "typeof",
  "instanceof",
  "await",
  "void",
  "delete",
  "new",
  "super",
  "import",
  "require",
  "yield",
  "with",
  "else",
  "case",
  "throw",
  "class",
  "of",
  "in",
  "as",
  "from",
]);

/**
 * @param {string} source
 * @returns {Array<{ local: string, spec: string }>}
 */
export function extractImportBindings(source) {
  const bindings = [];
  const text = String(source ?? "");

  // import Default from 'spec'
  // import Default, { a, b as c } from 'spec'
  // import * as ns from 'spec'
  // import { a, b as c } from 'spec'
  const fromImport =
    /\bimport\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = fromImport.exec(text))) {
    const clause = match[1].trim();
    const spec = match[2];
    if (!clause || !spec) continue;

    const star = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (star) {
      bindings.push({ local: star[1], spec });
      continue;
    }

    // Split default vs named: Default, { ... }  OR  { ... }  OR Default
    const named = clause.match(/\{([\s\S]*)\}/);
    const beforeNamed = named
      ? clause.slice(0, named.index).replace(/,\s*$/, "").trim()
      : clause.trim();
    if (beforeNamed && !beforeNamed.startsWith("{") && beforeNamed !== "*") {
      const defaultName = beforeNamed.split(/\s+as\s+/).pop();
      if (defaultName && /^[A-Za-z_$][\w$]*$/.test(defaultName)) {
        bindings.push({ local: defaultName, spec });
      }
    }
    if (named) {
      for (const part of named[1].split(",")) {
        const piece = part.trim();
        if (!piece || piece.startsWith("type ")) continue;
        const cleaned = piece.replace(/^type\s+/, "");
        const alias = cleaned.split(/\s+as\s+/);
        const local = (alias[1] || alias[0] || "").trim();
        if (local && /^[A-Za-z_$][\w$]*$/.test(local)) {
          bindings.push({ local, spec });
        }
      }
    }
  }

  // const x = await import('spec') / import('spec') assigned rarely — bind dynamic default as rare
  // Side-effect and bare dynamic imports don't create locals; skip.

  // require: const x = require('spec')
  const req =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = req.exec(text))) {
    bindings.push({ local: match[1], spec: match[2] });
  }

  return bindings;
}

/**
 * Local names that appear to be called in source.
 * @param {string} source
 * @returns {Set<string>}
 */
export function extractCalledLocals(source) {
  const called = new Set();
  const text = String(source ?? "");
  // Foo(  |  Foo.bar(  |  new Foo(
  const re =
    /\b(?:new\s+)?([A-Za-z_$][\w$]*)\s*(?:\.\s*[A-Za-z_$][\w$]*)?\s*\(/g;
  let match;
  while ((match = re.exec(text))) {
    const name = match[1];
    if (!name || CALL_KEYWORDS.has(name)) continue;
    called.add(name);
  }
  return called;
}

/**
 * Build file-level call edges from one source file.
 * @param {object} args
 * @param {string} args.fromId
 * @param {string} args.fromPath
 * @param {string} args.source
 * @param {(spec: string) => string | null} args.resolveSpec
 * @param {Set<string>} args.fileSet
 * @param {(path: string) => string} args.nodeIdForPath
 * @returns {Array<{ from: string, to: string, kind: string, weight: number }>}
 */
export function buildCallEdgesForFile({
  fromId,
  source,
  resolveSpec,
  fileSet,
  nodeIdForPath,
}) {
  const bindings = extractImportBindings(source);
  if (!bindings.length) return [];
  const called = extractCalledLocals(source);
  if (!called.size) return [];

  const localToSpec = new Map();
  for (const b of bindings) {
    if (!localToSpec.has(b.local)) localToSpec.set(b.local, b.spec);
  }

  const targets = new Set();
  for (const local of called) {
    const spec = localToSpec.get(local);
    if (!spec) continue;
    const target = resolveSpec(spec);
    if (!target || !fileSet.has(target)) continue;
    const toId = nodeIdForPath(target);
    if (toId === fromId) continue;
    targets.add(toId);
  }

  const edges = [];
  for (const toId of targets) {
    edges.push({ from: fromId, to: toId, kind: "calls", weight: 1 });
    edges.push({ from: toId, to: fromId, kind: "called_by", weight: 1 });
  }
  return edges;
}
