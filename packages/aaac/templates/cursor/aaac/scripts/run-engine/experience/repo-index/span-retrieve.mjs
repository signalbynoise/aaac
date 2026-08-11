/**
 * Stage-2 symbol intelligence: rank AST spans inside Stage-1 candidate files.
 */
import {
  loadSymbolsStore,
  searchSymbolVectors,
} from "./build.mjs";
import { envelopeForSpan } from "./symbols.mjs";

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
    if (!["imports", "imported_by", "calls", "called_by", "tests", "tested_by"].includes(edge.kind)) {
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
    out.push({
      path: symbol.path,
      symbol: symbol.name,
      kind: symbol.kind,
      parent: symbol.parent ?? null,
      start: symbol.start_line,
      end: symbol.end_line,
      envelope_start,
      envelope_end,
      signature: symbol.signature,
      snippet: symbol.snippet,
      why: whyParts.join(" "),
      score: Math.round(score * 1000) / 1000,
    });
    if (out.length >= finalSpans) break;
  }
  return out;
}
