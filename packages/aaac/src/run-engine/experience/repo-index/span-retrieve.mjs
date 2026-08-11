/**
 * Stage-2 symbol intelligence: rank AST spans inside Stage-1 candidate files.
 */
import fs from "fs";
import path from "path";
import {
  loadSymbolsStore,
  searchSymbolVectors,
} from "./build.mjs";
import { envelopeForSpan } from "./symbols.mjs";
import { resolveWorkspaceRoot } from "../repo-graph.mjs";

const STRUCTURAL_EXPAND_KINDS = new Set([
  "imports",
  "imported_by",
  "calls",
  "called_by",
  "tests",
  "tested_by",
]);

function readEnvelopeText(relativePath, envelopeStart, envelopeEnd, maxChars) {
  try {
    const root = resolveWorkspaceRoot();
    const abs = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(root, relativePath);
    if (!fs.existsSync(abs)) return "";
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    const start = Math.max(1, Number(envelopeStart) || 1);
    const end = Math.max(start, Number(envelopeEnd) || start);
    const slice = lines.slice(start - 1, end).join("\n");
    const cap = Math.max(200, Number(maxChars) || 2400);
    if (slice.length <= cap) return slice;
    return `${slice.slice(0, cap)}\n…`;
  } catch {
    return "";
  }
}

/**
 * Compact first-read pack for agents (inlined envelopes + structure pointers).
 */
export function buildReadPack({
  focusSpans = [],
  impact = [],
  call_neighbors = [],
  entry_flows = [],
  maxSpans = 8,
} = {}) {
  return {
    spans: focusSpans.slice(0, maxSpans).map((s) => ({
      path: s.path,
      symbol: s.symbol,
      kind: s.kind,
      envelope_start: s.envelope_start,
      envelope_end: s.envelope_end,
      envelope_text: s.envelope_text ?? "",
      why: s.why,
    })),
    impact: (impact ?? []).slice(0, 8),
    call_neighbors: (call_neighbors ?? []).slice(0, 8),
    entry_flows: (entry_flows ?? []).slice(0, 6),
  };
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_./+-]+/)
    .filter((t) => t.length > 1);
}

function sparseScoreSymbols(symbols, queryText, k = 32) {
  const qTokens = tokenize(queryText);
  if (!qTokens.length) return [];
  const scores = [];
  for (const symbol of symbols) {
    const text = [
      symbol.path,
      symbol.name,
      symbol.kind,
      symbol.parent,
      symbol.signature,
      symbol.snippet,
    ].join(" ");
    const tokens = new Set(tokenize(text));
    let hit = 0;
    for (const t of qTokens) {
      if (tokens.has(t)) hit += 1;
    }
    if (hit > 0) {
      scores.push({
        symbolId: symbol.id,
        symbol,
        score: hit / qTokens.length,
      });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k);
}

function rrfFuseIds(rankLists, rrfK = 60) {
  const scores = new Map();
  for (const list of rankLists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (rrfK + rank + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Expand Stage-1 focus paths with 1-hop import/call neighbors (capped).
 */
export function expandCandidatePaths(graph, focusPaths, { neighborCap = 8 } = {}) {
  const pathSet = new Set(focusPaths.filter(Boolean));
  if (!graph?.edges?.length || !neighborCap) return [...pathSet];

  const idToPath = new Map();
  for (const node of Object.values(graph.nodes ?? {})) {
    if (node.path) idToPath.set(node.id, node.path);
  }
  const pathToId = new Map(
    [...idToPath.entries()].map(([id, p]) => [p, id]),
  );

  const seedIds = focusPaths.map((p) => pathToId.get(p)).filter(Boolean);
  let added = 0;
  for (const edge of graph.edges ?? []) {
    if (added >= neighborCap) break;
    if (!STRUCTURAL_EXPAND_KINDS.has(edge.kind)) {
      continue;
    }
    const fromSeed = seedIds.includes(edge.from);
    const toSeed = seedIds.includes(edge.to);
    if (!fromSeed && !toSeed) continue;
    const other = fromSeed ? edge.to : edge.from;
    const p = idToPath.get(other);
    if (!p || pathSet.has(p)) continue;
    pathSet.add(p);
    added += 1;
  }
  return [...pathSet];
}

/**
 * Rank symbols inside candidate paths → focus_spans with envelopes.
 * @param {object[]} [options.symbols] — optional in-memory symbol records (tests / callers)
 */
export function rankFocusSpans({
  queryText,
  queryVec,
  candidatePaths,
  rm = {},
  rrfK = 60,
  symbols: symbolOverride = null,
} = {}) {
  const finalSpans = Number(rm.final_spans ?? 8);
  const spansPerFile = Number(rm.spans_per_file ?? 2);
  const envelopeLines = Number(rm.span_envelope_lines ?? 4);
  const envelopeMaxChars = Number(rm.envelope_max_chars ?? 2400);
  const pathSet = new Set(candidatePaths ?? []);
  if (!pathSet.size || finalSpans <= 0) return [];

  const store = symbolOverride ? null : loadSymbolsStore();
  const pool = symbolOverride ?? Object.values(store?.symbols ?? {});
  const inScope = pool.filter((s) => pathSet.has(s.path));
  if (!inScope.length) return [];

  const dense =
    queryVec && !symbolOverride
      ? searchSymbolVectors(queryVec, {
          k: Math.max(finalSpans * 4, 16),
          pathSet,
        })
      : [];
  const sparse = sparseScoreSymbols(
    inScope,
    queryText,
    Math.max(finalSpans * 4, 16),
  );
  const fused = rrfFuseIds(
    [dense.map((d) => d.symbolId), sparse.map((s) => s.symbolId)],
    rrfK,
  );

  const byId = new Map(inScope.map((s) => [s.id, s]));
  const denseScore = new Map(dense.map((d) => [d.symbolId, d.score]));
  const sparseScore = new Map(sparse.map((s) => [s.symbolId, s.score]));

  const perFile = new Map();
  const out = [];
  for (const { id, score } of fused) {
    const symbol = byId.get(id);
    if (!symbol) continue;
    const count = perFile.get(symbol.path) ?? 0;
    if (count >= spansPerFile) continue;
    perFile.set(symbol.path, count + 1);
    const { envelope_start, envelope_end } = envelopeForSpan(
      symbol.start_line,
      symbol.end_line,
      envelopeLines,
    );
    const whyParts = [];
    if (denseScore.has(id)) whyParts.push(`dense:${denseScore.get(id).toFixed(3)}`);
    if (sparseScore.has(id)) whyParts.push(`sparse:${sparseScore.get(id).toFixed(3)}`);
    whyParts.push(`stage1:${symbol.path}`);
    const envelope_text = readEnvelopeText(
      symbol.path,
      envelope_start,
      envelope_end,
      envelopeMaxChars,
    );
    out.push({
      path: symbol.path,
      symbol: symbol.name,
      kind: symbol.kind,
      parent: symbol.parent ?? null,
      start: symbol.start_line,
      end: symbol.end_line,
      envelope_start,
      envelope_end,
      envelope_text,
      signature: symbol.signature,
      snippet: symbol.snippet,
      why: whyParts.join(" "),
      score: Math.round(score * 1000) / 1000,
    });
    if (out.length >= finalSpans) break;
  }
  return out;
}
