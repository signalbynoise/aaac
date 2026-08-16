/**
 * Per-sought grant lists for retrieval-miss learning.
 * Never use global heal.resolved_paths — that aliases unrelated files.
 */
import fs from "fs";
import path from "path";
import { normalizeRepoPath } from "../evaluate-finding-tools.mjs";
import { extractPathTokensFromSought, basenameMatchesSought, identifierMatchesNode } from "../sought-paths.mjs";
import { CONTEXT_EVENTS, isSourceContextPath } from "../context-taxonomy.mjs";

const GRANTED_NOTES_RE = /^granted:(.+)$/i;
const MAX_GRANTED = 8;

export function normalizeGrantedPath(p) {
  return normalizeRepoPath(p);
}

/**
 * Source files plus docs/*.md may become retrieval aliases.
 * Ops/process/.cursor paths never learn.
 */
export function isLearnableGrantPath(p) {
  const n = normalizeGrantedPath(p);
  if (!n) return false;
  if (isSourceContextPath(n)) return true;
  return n.startsWith("docs/") && n.endsWith(".md");
}

/**
 * @param {string} notes
 * @returns {string[]}
 */
export function parseGrantedNotes(notes) {
  const raw = String(notes ?? "").trim();
  const m = raw.match(GRANTED_NOTES_RE);
  if (!m) return [];
  return uniqueGranted(
    m[1]
      .split(",")
      .map((p) => normalizeGrantedPath(p.trim()))
      .filter(Boolean),
  );
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeGrantedPaths(raw) {
  if (!Array.isArray(raw)) return [];
  return uniqueGranted(raw.map((p) => normalizeGrantedPath(p)).filter(Boolean));
}

function uniqueGranted(paths) {
  return [...new Set(paths.filter(isLearnableGrantPath))].slice(0, MAX_GRANTED);
}

/**
 * Granted file is confirmed when the ask names the path or the file basename.
 */
export function grantedPathConfirmed(relPath, sought) {
  const n = normalizeGrantedPath(relPath);
  if (!n) return false;
  const tokens = extractPathTokensFromSought(sought).map(normalizeGrantedPath);
  const base = path.basename(n);
  const stem = base.replace(/\.[^.]+$/, "");
  if (tokens.some((t) => t === n || t === base || t.endsWith(`/${base}`))) {
    return true;
  }
  const hay = String(sought ?? "").toLowerCase();
  if (stem.length >= 6 && hay.includes(stem.toLowerCase())) return true;
  if (base.length >= 6 && hay.includes(base.toLowerCase())) return true;
  return false;
}

/**
 * Join context_taxonomy.jsonl request_context rows whose need matches sought.
 * Broker truncates need to 200 chars.
 */
export function grantedPathsFromTaxonomyJsonl(artifactsDir, sought) {
  if (!artifactsDir || !sought) return [];
  const p = path.join(artifactsDir, "context_taxonomy.jsonl");
  if (!fs.existsSync(p)) return [];
  const needle = String(sought).trim();
  const needleHead = needle.slice(0, 200);
  const out = [];
  let text = "";
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return [];
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.tool !== "request_context") continue;
    const need = String(row.need ?? "").trim();
    if (!need) continue;
    const match =
      need === needle ||
      need === needleHead ||
      needle.startsWith(need) ||
      need.startsWith(needleHead);
    if (!match) continue;
    for (const raw of row.paths ?? []) out.push(normalizeGrantedPath(raw));
  }
  return uniqueGranted(out);
}

/**
 * Per-sought grant SSOT: structured field, granted: notes, then taxonomy jsonl.
 */
export function grantedPathsFromMiss(miss, artifactsDir = null) {
  const sought = String(miss?.sought ?? "").trim();
  const fromField = normalizeGrantedPaths(miss?.granted_paths);
  const fromNotes = parseGrantedNotes(miss?.notes);
  const fromJsonl = grantedPathsFromTaxonomyJsonl(artifactsDir, sought);
  return uniqueGranted([...fromField, ...fromNotes, ...fromJsonl]);
}

export function taxonomySkipReason(taxonomy) {
  if (taxonomy === CONTEXT_EVENTS.DISCOVERY_ATTEMPT) return "discovery_attempt";
  if (taxonomy === CONTEXT_EVENTS.OPS_CONTEXT_REQUEST) return "ops_context";
  if (taxonomy === CONTEXT_EVENTS.PROCESS_CONTEXT_REQUEST) return "process_context";
  if (taxonomy === CONTEXT_EVENTS.CONCEPTUAL_REQUEST) return "conceptual";
  if (taxonomy === CONTEXT_EVENTS.PATH_ALIAS) return "path_alias";
  return null;
}

/**
 * Confirm learn targets: granted paths named in the ask, plus by_sought hits
 * that were harvested or share a basename token. Never uses global resolved_paths.
 *
 * @returns {{ confirmed: string[], hadCandidate: boolean, skipReason: string|null }}
 */
export function confirmLearnCandidates({
  sought,
  grantedPaths = [],
  bySoughtHits = [],
  harvested = [],
  pathExists = () => false,
  apiByPath = {},
} = {}) {
  const harvestedSet = new Set(
    (Array.isArray(harvested) ? harvested : []).map(normalizeGrantedPath).filter(Boolean),
  );
  const pathTokens = extractPathTokensFromSought(sought).map(normalizeGrantedPath);
  const confirmed = [];
  const seen = new Set();
  const add = (p) => {
    const n = normalizeGrantedPath(p);
    if (!n || seen.has(n) || !isLearnableGrantPath(n)) return;
    seen.add(n);
    confirmed.push(n);
  };

  for (const t of pathTokens) {
    if (pathExists(t) || harvestedSet.has(t)) add(t);
  }

  const grants = uniqueGranted(grantedPaths);
  const resolverHits = [
    ...new Set((Array.isArray(bySoughtHits) ? bySoughtHits : []).map(normalizeGrantedPath).filter(Boolean)),
  ];
  const hadCandidate = grants.length > 0 || resolverHits.length > 0;

  const grantConfirmed = grants.filter(
    (p) =>
      pathTokens.includes(p) ||
      pathTokens.includes(path.basename(p)) ||
      grantedPathConfirmed(p, sought) ||
      identifierMatchesNode(p, apiByPath[p], sought),
  );
  const harvestedGrants = grantConfirmed.filter((p) => harvestedSet.has(p));
  const grantFinal =
    harvestedSet.size > 0 && harvestedGrants.length > 0 ? harvestedGrants : grantConfirmed;
  for (const p of grantFinal) add(p);

  for (const p of resolverHits) {
    if (seen.has(p) || !isLearnableGrantPath(p)) continue;
    if (harvestedSet.has(p) || (pathExists(p) && (
      basenameMatchesSought(p, sought) ||
      identifierMatchesNode(p, apiByPath[p], sought)
    ))) {
      add(p);
    }
  }

  let skipReason = null;
  if (!confirmed.length) {
    if (grants.length) skipReason = "weak_grant";
    else if (resolverHits.length) skipReason = "unconfirmed";
    else skipReason = pathTokens.length ? "empty_expand" : "conceptual";
  }
  return { confirmed, hadCandidate, skipReason };
}
