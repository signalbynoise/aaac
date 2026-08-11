/**
 * AST symbol + span extraction via web-tree-sitter (WASM).
 * File-level geography stays in repo-graph; this sidecar answers
 * "what exact code should the agent read?"
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { tryRequireDep } from "../deps.mjs";
import { loadRetrievalConfig } from "../paths.mjs";

const REQUIRE = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const EXT_TO_GRAMMAR = {
  ".ts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-tsx.wasm",
  ".js": "tree-sitter-javascript.wasm",
  ".jsx": "tree-sitter-javascript.wasm",
  ".mjs": "tree-sitter-javascript.wasm",
  ".cjs": "tree-sitter-javascript.wasm",
  ".py": "tree-sitter-python.wasm",
};

const TS_LIKE = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "method_definition",
  "abstract_method_signature",
  "method_signature",
  "public_field_definition",
]);

const PY_LIKE = new Set(["function_definition", "class_definition"]);

/** @type {Promise<any>|null} */
let parserReady = null;
/** @type {Map<string, any>} */
const languageCache = new Map();
/** @type {any} */
let ParserCtor = null;

function contentHash(text) {
  return createHash("sha256").update(String(text ?? "")).digest("hex").slice(0, 16);
}

function resolveGrammarPath(filename) {
  const candidates = [
    path.join(HERE, "grammars", filename),
    path.join(HERE, "wasm", filename),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    return REQUIRE.resolve(`tree-sitter-wasms/out/${filename}`);
  } catch {
    // fall through
  }
  try {
    const fromDep = createRequire(
      REQUIRE.resolve("web-tree-sitter"),
    ).resolve(`tree-sitter-wasms/out/${filename}`);
    if (fs.existsSync(fromDep)) return fromDep;
  } catch {
    // fall through
  }
  return null;
}

function resolveWebTreeSitterWasm() {
  try {
    const entry = REQUIRE.resolve("web-tree-sitter");
    const dir = path.dirname(entry);
    for (const name of ["tree-sitter.wasm", "web-tree-sitter.wasm"]) {
      const sibling = path.join(dir, name);
      if (fs.existsSync(sibling)) return sibling;
    }
  } catch {
    // fall through
  }
  for (const name of ["tree-sitter.wasm", "web-tree-sitter.wasm"]) {
    const vendored = path.join(HERE, "grammars", name);
    if (fs.existsSync(vendored)) return vendored;
  }
  return null;
}

async function ensureParser() {
  if (parserReady) return parserReady;
  parserReady = (async () => {
    let mod = null;
    try {
      mod = REQUIRE("web-tree-sitter");
    } catch {
      mod = tryRequireDep("web-tree-sitter");
    }
    const Parser = mod?.default ?? mod?.Parser ?? mod;
    if (typeof Parser?.init !== "function") {
      throw new Error("web-tree-sitter unavailable");
    }
    const wasmPath = resolveWebTreeSitterWasm();
    await Parser.init(
      wasmPath
        ? { locateFile: () => wasmPath }
        : undefined,
    );
    // Language is attached to Parser only after init (CJS 0.24.x)
    if (!Parser.Language?.load) {
      throw new Error("web-tree-sitter Language unavailable after init");
    }
    ParserCtor = Parser;
    return Parser;
  })().catch((err) => {
    parserReady = null;
    throw err;
  });
  return parserReady;
}

async function loadLanguageForExt(ext) {
  const grammar = EXT_TO_GRAMMAR[ext];
  if (!grammar) return null;
  if (languageCache.has(grammar)) return languageCache.get(grammar);
  const Parser = await ensureParser();
  const grammarPath = resolveGrammarPath(grammar);
  if (!grammarPath) {
    console.warn(`[warn] [repo-index:symbols] missing grammar ${grammar}`);
    return null;
  }
  const language = await Parser.Language.load(grammarPath);
  languageCache.set(grammar, language);
  return language;
}

function childByField(node, field) {
  try {
    return node.childForFieldName?.(field) ?? null;
  } catch {
    return null;
  }
}

function nodeName(node) {
  const nameNode =
    childByField(node, "name") ||
    node.namedChildren?.find((c) => c.type === "identifier" || c.type === "property_identifier");
  return nameNode?.text ?? null;
}

function firstLine(text) {
  return String(text ?? "").split(/\r?\n/, 1)[0].trim().slice(0, 240);
}

function snippetOf(text, maxChars = 280) {
  const compact = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return compact.slice(0, maxChars);
}

function symbolId(filePath, name, startLine) {
  return `sym:${filePath}#${name}@${startLine}`;
}

function kindForNode(type) {
  if (type === "class_declaration" || type === "class_definition") return "class";
  if (
    type === "method_definition" ||
    type === "method_signature" ||
    type === "abstract_method_signature"
  ) {
    return "method";
  }
  if (type === "public_field_definition") return "field";
  return "function";
}

/**
 * Walk AST and collect definition symbols with line spans.
 * @param {any} root
 * @param {string} source
 * @param {string} langFamily "ts" | "py"
 */
function collectFromTree(root, source, langFamily) {
  const out = [];
  const interesting = langFamily === "py" ? PY_LIKE : TS_LIKE;

  function visit(node, classParent = null) {
    if (!node) return;
    const type = node.type;
    let nextClass = classParent;

    if (interesting.has(type)) {
      const name = nodeName(node);
      if (name) {
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const startByte = node.startIndex;
        const endByte = node.endIndex;
        const body = source.slice(startByte, endByte);
        const isMethod =
          type === "method_definition" ||
          type === "method_signature" ||
          type === "abstract_method_signature" ||
          (type === "function_definition" && Boolean(classParent));
        out.push({
          name,
          kind: isMethod ? "method" : kindForNode(type),
          parent: isMethod ? classParent : null,
          start_line: startLine,
          end_line: endLine,
          start_byte: startByte,
          end_byte: endByte,
          signature: firstLine(body),
          snippet: snippetOf(body),
        });
        if (type === "class_declaration" || type === "class_definition") {
          nextClass = name;
        }
      }
    }

    // Arrow / function expressions assigned to const exports: export const foo = () => {}
    if (
      langFamily === "ts" &&
      type === "lexical_declaration" &&
      node.parent?.type === "export_statement"
    ) {
      for (const declarator of node.namedChildren.filter((c) => c.type === "variable_declarator")) {
        const name = nodeName(declarator);
        const value = childByField(declarator, "value");
        if (
          !name ||
          !value ||
          !["arrow_function", "function_expression", "function"].includes(value.type)
        ) {
          continue;
        }
        const startLine = declarator.startPosition.row + 1;
        const endLine = value.endPosition.row + 1;
        const startByte = declarator.startIndex;
        const endByte = value.endIndex;
        const body = source.slice(startByte, endByte);
        out.push({
          name,
          kind: "export",
          parent: null,
          start_line: startLine,
          end_line: endLine,
          start_byte: startByte,
          end_byte: endByte,
          signature: firstLine(body),
          snippet: snippetOf(body),
        });
      }
    }

    for (const child of node.namedChildren ?? []) {
      visit(child, nextClass);
    }
  }

  visit(root, null);
  return out;
}

/**
 * Extract AST symbols for one source file.
 * @returns {Promise<object[]>}
 */
export async function extractSymbolsForFile({
  path: relativePath,
  source,
  fileNodeId,
  contentHash: hash,
  maxSymbols,
} = {}) {
  const ext = path.extname(relativePath || "").toLowerCase();
  if (!EXT_TO_GRAMMAR[ext]) return [];
  const cfg = loadRetrievalConfig().repo_memory ?? {};
  const cap = Number(maxSymbols ?? cfg.max_symbols_per_file ?? 80);
  const text = String(source ?? "");
  if (!text.trim()) return [];

  let language;
  try {
    language = await loadLanguageForExt(ext);
  } catch (err) {
    console.warn(
      `[warn] [repo-index:symbols] language load failed ${relativePath}: ${String(err?.message ?? err).slice(0, 160)}`,
    );
    return [];
  }
  if (!language || !ParserCtor) return [];

  try {
    const parser = new ParserCtor();
    parser.setLanguage(language);
    const tree = parser.parse(text);
    const langFamily = ext === ".py" ? "py" : "ts";
    const raw = collectFromTree(tree.rootNode, text, langFamily);
    // Do not delete parser/tree — web-tree-sitter WASM shared state breaks later parses.

    const fileHash = hash || contentHash(text);
    const seen = new Set();
    const records = [];
    for (const item of raw) {
      const id = symbolId(relativePath, item.name, item.start_line);
      if (seen.has(id)) continue;
      seen.add(id);
      records.push({
        id,
        path: relativePath,
        name: item.name,
        kind: item.kind,
        parent: item.parent,
        start_line: item.start_line,
        end_line: item.end_line,
        start_byte: item.start_byte,
        end_byte: item.end_byte,
        signature: item.signature,
        snippet: item.snippet,
        file_node_id: fileNodeId,
        content_hash: fileHash,
      });
      if (records.length >= cap) break;
    }
    return records;
  } catch (err) {
    console.warn(
      `[warn] [repo-index:symbols] parse failed ${relativePath}: ${String(err?.message ?? err).slice(0, 160)}`,
    );
    return [];
  }
}

/**
 * Compute envelope line range around a symbol span.
 */
export function envelopeForSpan(start, end, envelopeLines, fileLineCount = Infinity) {
  const pad = Math.max(0, Number(envelopeLines) || 0);
  const envelope_start = Math.max(1, start - pad);
  const envelope_end = Math.min(fileLineCount, end + pad);
  return { envelope_start, envelope_end };
}

export function symbolEmbedText(symbol) {
  return [
    symbol.path,
    symbol.name,
    symbol.kind,
    symbol.parent ? `parent:${symbol.parent}` : "",
    symbol.signature,
    symbol.snippet,
  ]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 800);
}

export function emptySymbolsStore() {
  return { version: 1, updated_at: null, symbols: {} };
}

/** Reset parser caches (tests). */
export function resetSymbolParserCache() {
  parserReady = null;
  languageCache.clear();
  ParserCtor = null;
}

export { EXT_TO_GRAMMAR, contentHash as hashSource };
