/**
 * Host-side context resolver — the only widening operation for capsule workers.
 * Treats `need` as a semantic query. Never grants because a path exists.
 */
import fs from "fs";
import path from "path";
import { normalizeRepoPath } from "./evaluate-finding-tools.mjs";
import { resolvePathsForSought } from "./retrieval-miss.mjs";
import { loadRetrievalConfig } from "./experience/paths.mjs";
import {
  CONTEXT_EVENTS,
  classifySought,
  isSourceContextPath,
} from "./context-taxonomy.mjs";
import {
  addGrantToCapsule,
  grantPathSet,
  readCapsuleGrants,
  writeCapsuleGrants,
} from "./worker-capsule.mjs";
import { recordRetrievalMiss } from "./retrieval-miss.mjs";

export function capsuleBudgets(retrievalDefaults = null) {
  const rm = retrievalDefaults ?? loadRetrievalConfig()?.repo_memory ?? {};
  return {
    max_expansions: Number(rm.max_expansions) || 3,
    max_files_per_expansion: Number(rm.max_files_per_expansion) || 4,
  };
}

function workerNamedUngrantedPath(need, grants) {
  const n = normalizeRepoPath(need);
  if (!n || !n.includes("/")) return null;
  if (!isSourceContextPath(n)) return null;
  if (grantPathSet(grants).has(n)) return n;
  return n;
}

/**
 * @returns {Promise<object>}
 */
export async function resolveContextRequest({
  workspaceRoot,
  runId,
  manifest = null,
  capsuleDir,
  need,
  because = "",
  anchor = null,
  retrieve = true,
} = {}) {
  const grants = readCapsuleGrants(capsuleDir);
  const budgets = capsuleBudgets();
  const expansions = Number(grants.expansions) || 0;
  if (expansions >= budgets.max_expansions) {
    return {
      ok: false,
      status: "BUDGET",
      taxonomy: CONTEXT_EVENTS.NOT_GRANTED,
      message: `max_expansions=${budgets.max_expansions} exhausted`,
      packet_delta: { paths: [] },
    };
  }

  const needText = String(need ?? "").trim();
  if (!needText) {
    return {
      ok: false,
      status: "NOT_GRANTED",
      taxonomy: CONTEXT_EVENTS.CONCEPTUAL_REQUEST,
      message: "need is required",
      packet_delta: { paths: [] },
    };
  }

  const taxonomy = classifySought(needText);
  if (
    taxonomy === CONTEXT_EVENTS.DISCOVERY_ATTEMPT ||
    taxonomy === CONTEXT_EVENTS.OPS_CONTEXT_REQUEST ||
    taxonomy === CONTEXT_EVENTS.PROCESS_CONTEXT_REQUEST
  ) {
    return {
      ok: false,
      status: "NOT_GRANTED",
      taxonomy,
      message: "Not SOURCE_CONTEXT — request a semantic source need",
      packet_delta: { paths: [] },
    };
  }

  const named = workerNamedUngrantedPath(needText, grants);
  const grantedNamed = named && grantPathSet(grants).has(named);
  if (named && !grantedNamed) {
    // Worker guessed a path. Treat as query text only — do not grant by existence.
  }

  const soughtTerms = [
    needText,
    because,
    anchor?.symbol,
    grantPathSet(grants).has(normalizeRepoPath(anchor?.path))
      ? path.basename(anchor.path)
      : null,
  ]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean);

  const resolved = resolvePathsForSought(soughtTerms, {
    maxPaths: budgets.max_files_per_expansion,
    knownFocus: [...grantPathSet(grants)],
  });

  let paths = (resolved.paths ?? []).filter(isSourceContextPath);
  if (retrieve && !paths.length) {
    try {
      const { retrieveRepoMemory } = await import("./experience/retrieve-repo.mjs");
      const packet = await retrieveRepoMemory(
        {
          ...(manifest ?? {}),
          intent: `${manifest?.intent ?? ""} ${soughtTerms.join(" ")}`.trim(),
        },
        {
          emit: false,
          maxNodes: budgets.max_files_per_expansion,
          retrievalHints: { sought_terms: soughtTerms },
        },
      );
      paths = [
        ...new Set(
          [...(packet.focus_paths ?? []), ...(packet.nodes ?? []).map((n) => n?.path)]
            .map(normalizeRepoPath)
            .filter(isSourceContextPath),
        ),
      ].slice(0, budgets.max_files_per_expansion);
    } catch {
      // graph retrieve optional
    }
  }

  paths = paths.filter((p) => !grantPathSet(grants).has(p)).slice(
    0,
    budgets.max_files_per_expansion,
  );

  if (!paths.length) {
    if (runId) {
      try {
        recordRetrievalMiss(
          runId,
          {
            sought: needText,
            reason:
              taxonomy === CONTEXT_EVENTS.ENVELOPE_TOO_THIN
                ? "envelope_too_thin"
                : "not_in_focus",
            taxonomy,
            notes: because,
            phase: manifest?.phase ?? null,
          },
          { dedupe: true },
        );
      } catch {
        // optional
      }
    }
    return {
      ok: false,
      status: "NOT_GRANTED",
      taxonomy,
      message: "Resolver found no SOURCE_CONTEXT for this need",
      packet_delta: { paths: [] },
    };
  }

  const added = [];
  for (const rel of paths) {
    const result = addGrantToCapsule({
      workspaceRoot,
      capsuleDir,
      relPath: rel,
      packetVersion: "request_context",
    });
    if (result.ok) added.push(rel);
  }

  const next = readCapsuleGrants(capsuleDir);
  next.expansions = expansions + 1;
  writeCapsuleGrants(capsuleDir, next);

  if (runId && added.length) {
    try {
      recordRetrievalMiss(
        runId,
        {
          sought: needText,
          reason: "not_in_focus",
          taxonomy,
          granted_paths: added,
          notes: `granted:${added.join(",")}`,
          phase: manifest?.phase ?? null,
        },
        { dedupe: true },
      );
    } catch {
      // optional
    }
  }

  return {
    ok: added.length > 0,
    status: added.length ? "GRANTED" : "NOT_GRANTED",
    taxonomy,
    packet_delta: { paths: added },
    message:
      added.length > 0
        ? `Granted ${added.length} source file(s). Read only those paths.`
        : "Resolver hits were not source files",
  };
}

export function readGrantedContext({ capsuleDir, relPath, start = null, end = null } = {}) {
  const n = normalizeRepoPath(relPath);
  const grants = readCapsuleGrants(capsuleDir);
  if (!n || !grantPathSet(grants).has(n)) {
    return {
      status: "NOT_GRANTED",
      taxonomy: CONTEXT_EVENTS.NOT_GRANTED,
      text: null,
    };
  }
  const abs = path.join(capsuleDir, n);
  if (!fs.existsSync(abs)) {
    return {
      status: "NOT_GRANTED",
      taxonomy: CONTEXT_EVENTS.NOT_GRANTED,
      text: null,
    };
  }
  const raw = fs.readFileSync(abs, "utf8");
  const lines = raw.split("\n");
  const s = start != null ? Math.max(1, Number(start)) : 1;
  const e = end != null ? Math.min(lines.length, Number(end)) : lines.length;
  return {
    status: "IN_PACKET",
    taxonomy: CONTEXT_EVENTS.PACKET_CACHE_HIT,
    path: n,
    start: s,
    end: e,
    text: lines.slice(s - 1, e).join("\n"),
  };
}
