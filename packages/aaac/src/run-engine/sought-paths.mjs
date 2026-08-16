/**
 * Path / token extraction from retrieval_miss sought strings.
 * Shared by heal, learn, and the read-scope gate.
 */
import path from "path";
import fs from "fs";

const PATH_PREFIX_RE =
  /(?:^|[\s`"'(|=,])((?:apps|packages|src|tests?|docs|\.cursor)\/[A-Za-z0-9_./+-]+\.[A-Za-z0-9]+)(?=[\s`"'`),:|]|$)/g;

const BARE_FILE_RE =
  /(?:^|[\s`"'(|=,])([A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9]{1,8})(?=[\s`"'`),:|]|$)/g;

const BRACE_RE =
  /((?:apps|packages|src|tests?|docs|\.cursor)\/[A-Za-z0-9_./+-]*)\{([^}]+)\}(\.[A-Za-z0-9]+)?/g;

export const SOUGHT_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "full",
  "body",
  "bodies",
  "src",
  "apps",
  "packages",
  "test",
  "tests",
  "docs",
  "cursor",
  "barrel",
  "vector",
  "file",
  "files",
  "path",
  "paths",
  "read",
  "tool",
  "opens",
  "spot",
  "check",
  "remaining",
  "other",
  "this",
  "that",
  "into",
  "over",
  "under",
  "after",
  "before",
  "via",
  "main",
  "handler",
  "handlers",
  "source",
  "exports",
  "formal",
  "domain",
  "inventory",
  "exceptions",
  "union",
  "peer",
  "ssot",
]);

/**
 * @param {string} p
 * @returns {string}
 */
export function normalizeRelPath(p) {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

/**
 * Extract every path-shaped token from a sought string
 * (parentheticals, pipes, commas, brace expansions).
 * @param {string} sought
 * @returns {string[]}
 */
export function extractPathTokensFromSought(sought) {
  const text = String(sought ?? "").trim();
  if (!text) return [];
  const out = [];

  for (const m of text.matchAll(BRACE_RE)) {
    const prefix = m[1] ?? "";
    const ext = m[3] ?? "";
    for (const part of String(m[2] ?? "").split(",")) {
      const piece = `${prefix}${part.trim()}${ext}`;
      if (piece.includes("/")) out.push(normalizeRelPath(piece));
    }
  }

  const padded = ` ${text.replace(/\|/g, " | ")} `;
  PATH_PREFIX_RE.lastIndex = 0;
  let m;
  while ((m = PATH_PREFIX_RE.exec(padded))) {
    out.push(normalizeRelPath(m[1]));
  }

  for (const chunk of text.split(/[|,]/)) {
    const t = chunk.trim().split(/\s+/)[0] ?? "";
    if (
      /^(?:apps|packages|src|tests?|docs|\.cursor)\//.test(t) &&
      /\.[A-Za-z0-9]{1,8}$/.test(t)
    ) {
      out.push(normalizeRelPath(t.replace(/[)`'"]+$/g, "")));
    }
  }

  BARE_FILE_RE.lastIndex = 0;
  while ((m = BARE_FILE_RE.exec(padded))) {
    const bare = normalizeRelPath(m[1]);
    if (bare.includes("/")) continue;
    out.push(bare);
  }

  return [...new Set(out.filter(Boolean))];
}

/**
 * Significant tokens from a sought string (camelCase split, stopwords dropped).
 * @param {string} text
 * @returns {string[]}
 */
export function significantSoughtTokens(text) {
  const split = String(text ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return split
    .split(/[^a-z0-9_./+-]+/)
    .filter((t) => t.length > 3 && !SOUGHT_STOPWORDS.has(t))
    .slice(0, 16);
}

/**
 * True when a repo path's basename is a real match for the sought term.
 * Rejects weak token overlap ("barrel" → ui-barrel-continue-banner).
 * @param {string} relPath
 * @param {string} sought
 */
export function basenameMatchesSought(relPath, sought) {
  const base = path
    .basename(normalizeRelPath(relPath))
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
  const compact = base.replace(/[^a-z0-9]/g, "");
  const tokens = significantSoughtTokens(sought);
  if (!tokens.length) return false;
  if (
    tokens.some(
      (t) => t.length >= 8 && (compact.includes(t) || base.includes(t)),
    )
  ) {
    return true;
  }
  const hits = tokens.filter((t) => compact.includes(t) || base.includes(t));
  return hits.length >= 2;
}

const IDENTIFIER_STOP = new Set([
  "SOURCE_CONTEXT",
  "PACKET_CACHE",
  "PACKET_CACHE_HIT",
  "NOT_GRANTED",
  "TRUE_RETRIEVAL",
  "TRUE_RETRIEVAL_MISS",
  "CONCEPTUAL_REQUEST",
  "ENVELOPE_TOO_THIN",
  "DISCOVERY_ATTEMPT",
  "OPS_CONTEXT_REQUEST",
  "PROCESS_CONTEXT_REQUEST",
  "PATH_ALIAS",
  "PATH_NORMALIZED",
  "REDUNDANT_READ",
]);

/**
 * PascalCase / camelCase / CONST_CASE tokens as the worker wrote them.
 * significantSoughtTokens splits these and cannot match node.api symbols.
 * The camel regex requires a lowercase run before an interior capital so
 * FOUR_LEVEL / SOURCE_CONTEXT are not split into fake identifiers.
 */
export function identifierTokensFromSought(sought) {
  const text = String(sought ?? "");
  const out = [];
  for (const m of text.matchAll(/[A-Za-z][a-z0-9]*[a-z][A-Z][A-Za-z0-9]*/g)) {
    out.push(m[0]);
  }
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(_[A-Z0-9]+)+\b/g)) {
    out.push(m[0]);
  }
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g)) {
    if (m[0].length >= 8) out.push(m[0]);
  }
  return [...new Set(out.filter((t) => !IDENTIFIER_STOP.has(t)))];
}

function compactIdent(s) {
  return String(s ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

/**
 * True when a sought identifier names this file (basename) or an exported symbol (api).
 */
export function identifierMatchesNode(relPath, api, sought) {
  const ids = identifierTokensFromSought(sought);
  if (!ids.length) return false;
  const compactBase = compactIdent(
    path.basename(normalizeRelPath(relPath)).replace(/\.[^.]+$/, ""),
  );
  const apiLower = ` ${String(api ?? "").toLowerCase()} `;
  for (const id of ids) {
    const compactId = compactIdent(id);
    if (compactId.length < 6) continue;
    if (
      compactBase === compactId ||
      (compactId.length >= 8 && compactBase.includes(compactId)) ||
      (compactBase.length >= 8 && compactId.includes(compactBase))
    ) {
      return true;
    }
    const needle = id.toLowerCase();
    if (apiLower.includes(` ${needle} `) || apiLower.includes(` ${needle},`)) {
      return true;
    }
    if (apiLower.includes(`, ${needle} `) || apiLower.includes(`, ${needle},`)) {
      return true;
    }
    if (apiLower.trim() === needle) return true;
  }
  return false;
}

export function nodeMatchesSought(relPath, sought, api = "") {
  const n = normalizeRelPath(relPath);
  const pathTokens = extractPathTokensFromSought(sought).map(normalizeRelPath);
  if (pathTokens.includes(n) || pathTokens.includes(path.basename(n))) {
    return true;
  }
  return (
    basenameMatchesSought(relPath, sought) ||
    identifierMatchesNode(relPath, api, sought)
  );
}

/**
 * @param {string} rel
 * @param {string} workspaceRoot
 */
export function pathExistsUnderRoot(rel, workspaceRoot) {
  const n = normalizeRelPath(rel);
  if (!n || n.includes("..")) return false;
  const abs = path.isAbsolute(n) ? n : path.join(workspaceRoot, n);
  try {
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}
