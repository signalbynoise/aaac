/**
 * Context-boundary taxonomy — emitted at the gate/broker, not after the run.
 * Only TRUE_RETRIEVAL_MISS and ENVELOPE_TOO_THIN may become graph learning.
 */
import { normalizeRepoPath } from "./evaluate-finding-tools.mjs";

export const CONTEXT_EVENTS = Object.freeze({
  PATH_NORMALIZED: "PATH_NORMALIZED",
  PACKET_CACHE_HIT: "PACKET_CACHE_HIT",
  REDUNDANT_READ: "REDUNDANT_READ",
  DISCOVERY_ATTEMPT: "DISCOVERY_ATTEMPT",
  OPS_CONTEXT_REQUEST: "OPS_CONTEXT_REQUEST",
  PROCESS_CONTEXT_REQUEST: "PROCESS_CONTEXT_REQUEST",
  CONCEPTUAL_REQUEST: "CONCEPTUAL_REQUEST",
  TRUE_RETRIEVAL_MISS: "TRUE_RETRIEVAL_MISS",
  ENVELOPE_TOO_THIN: "ENVELOPE_TOO_THIN",
  PATH_ALIAS: "PATH_ALIAS",
  NOT_GRANTED: "NOT_GRANTED",
  GRANTED: "GRANTED",
});

export const LEARNABLE_TAXONOMY = Object.freeze(
  new Set([CONTEXT_EVENTS.TRUE_RETRIEVAL_MISS, CONTEXT_EVENTS.ENVELOPE_TOO_THIN]),
);

const PATH_TOKEN_RE =
  /(?:[\w@.-]+\/)+[\w.-]+\.[A-Za-z][A-Za-z0-9]*|[\w.-]+\.(?:ts|tsx|js|mjs|cjs|json|md)/;

const OPS_RE =
  /(^|\/)(\.cursor\/aaac\/state|active-runs|phase_context|terminals\/|cli-latest)/i;
const PROCESS_RE =
  /(^|\/)(\.cursor\/(agents|policies|skills|commands)|cursor\/(agents|policies|skills)|SKILL\.md|complexity\.yaml|dispatch\.md|minimal-complexity|agent-separation)/i;
const SOURCE_RE =
  /^(apps|packages|src|lib|services)\//;

export function isDirectorySought(sought) {
  const n = normalizeRepoPath(sought);
  if (!n || !n.includes("/")) return false;
  const base = n.split("/").pop() ?? n;
  if (base.includes(".")) return false;
  return !PATH_TOKEN_RE.test(n);
}

export function isAbsoluteAliasSought(sought) {
  const raw = String(sought ?? "").trim();
  return raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("file://");
}

export function classifySought(sought) {
  const raw = String(sought ?? "").trim();
  if (!raw) return CONTEXT_EVENTS.CONCEPTUAL_REQUEST;
  if (isAbsoluteAliasSought(raw)) return CONTEXT_EVENTS.PATH_ALIAS;
  const n = normalizeRepoPath(raw);
  if (OPS_RE.test(n) || OPS_RE.test(raw)) return CONTEXT_EVENTS.OPS_CONTEXT_REQUEST;
  if (PROCESS_RE.test(n) || PROCESS_RE.test(raw)) {
    return CONTEXT_EVENTS.PROCESS_CONTEXT_REQUEST;
  }
  if (isDirectorySought(raw) || isDirectorySought(n)) {
    return CONTEXT_EVENTS.DISCOVERY_ATTEMPT;
  }
  if (SOURCE_RE.test(n) && PATH_TOKEN_RE.test(n)) {
    return CONTEXT_EVENTS.TRUE_RETRIEVAL_MISS;
  }
  if (!PATH_TOKEN_RE.test(raw) && !n.includes("/")) {
    return CONTEXT_EVENTS.CONCEPTUAL_REQUEST;
  }
  if (!SOURCE_RE.test(n)) {
    if (n.startsWith("docs/") && PATH_TOKEN_RE.test(n)) {
      return CONTEXT_EVENTS.TRUE_RETRIEVAL_MISS;
    }
    if (n.startsWith(".cursor/") || n.startsWith("cursor/")) {
      return CONTEXT_EVENTS.PROCESS_CONTEXT_REQUEST;
    }
    return CONTEXT_EVENTS.CONCEPTUAL_REQUEST;
  }
  return CONTEXT_EVENTS.CONCEPTUAL_REQUEST;
}

export function isSourceContextPath(p) {
  const n = normalizeRepoPath(p);
  if (!n) return false;
  if (OPS_RE.test(n) || PROCESS_RE.test(n)) return false;
  if (isDirectorySought(n)) return false;
  if (n.startsWith(".cursor/") || n.startsWith("cursor/")) return false;
  return SOURCE_RE.test(n) || /\.(ts|tsx|js|mjs|cjs)$/.test(n);
}

export function isLearnableTaxonomy(taxonomy, sought) {
  if (taxonomy && LEARNABLE_TAXONOMY.has(taxonomy)) return true;
  if (taxonomy) return false;
  return classifySought(sought) === CONTEXT_EVENTS.TRUE_RETRIEVAL_MISS;
}
