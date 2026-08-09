/**
 * Consolidate / merge / prune lesson store.
 * Clusters by failure_class + primary artifact/phase; preserves evidence.
 */

import { isoNow } from "../lib.mjs";
import { deriveConfidence } from "./math.mjs";

function clusterKey(lesson) {
  if (lesson.failure_class) {
    const artifact = lesson.context?.artifact ?? "";
    const phase = lesson.context?.phase ?? "";
    return `${lesson.failure_class}|${phase}|${artifact}`;
  }
  // Generic lessons: cluster by id prefix
  const id = String(lesson.id ?? "");
  if (id.startsWith("lesson-bottleneck-")) return id;
  if (id.startsWith("rec-optimize-")) return `rec|${lesson.context?.phase ?? id}`;
  return id;
}

function mergeEvidence(a = {}, b = {}) {
  const observed = (a.observed_runs ?? 0) + (b.observed_runs ?? 0);
  const successful = (a.successful_runs ?? 0) + (b.successful_runs ?? 0);
  const failed = (a.failed_runs ?? 0) + (b.failed_runs ?? 0);
  const contradicted = (a.contradicted_runs ?? 0) + (b.contradicted_runs ?? 0);
  const merged = {
    observed_runs: observed,
    successful_runs: successful,
    failed_runs: failed,
    contradicted_runs: contradicted,
    token_savings_pct: a.token_savings_pct ?? b.token_savings_pct ?? null,
    average_runtime_improvement_pct:
      a.average_runtime_improvement_pct ??
      b.average_runtime_improvement_pct ??
      null,
    last_run_id: b.last_run_id ?? a.last_run_id ?? null,
    updated_at: isoNow(),
  };
  merged.confidence = deriveConfidence(merged);
  return merged;
}

function pickCanonical(lessons) {
  // Prefer structured failure lessons with highest observed_runs.
  return [...lessons].sort((a, b) => {
    const ae = a.evidence?.observed_runs ?? 0;
    const be = b.evidence?.observed_runs ?? 0;
    if (be !== ae) return be - ae;
    const as = a.kind === "structured" ? 1 : 0;
    const bs = b.kind === "structured" ? 1 : 0;
    return bs - as;
  })[0];
}

/**
 * Merge duplicate/near-duplicate lessons in-place on store.
 * @returns {{ merged: number, deprecated: string[], clusters: number }}
 */
export function consolidateLessonsStore(store) {
  const lessons = Object.values(store.lessons ?? {});
  const clusters = new Map();
  for (const lesson of lessons) {
    if (lesson.status === "deprecated") continue;
    const key = clusterKey(lesson);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(lesson);
  }

  let merged = 0;
  const deprecated = [];

  for (const [, group] of clusters) {
    if (group.length < 2) continue;
    const canonical = pickCanonical(group);
    for (const other of group) {
      if (other.id === canonical.id) continue;
      canonical.evidence = mergeEvidence(canonical.evidence, other.evidence);
      canonical.supporting_run_ids = [
        ...new Set([
          ...(canonical.supporting_run_ids ?? []),
          ...(other.supporting_run_ids ?? []),
          ...(other.merged_from ?? []),
        ]),
      ].slice(-80);
      canonical.merged_from = [
        ...new Set([...(canonical.merged_from ?? []), other.id]),
      ];
      // Prefer richer structured fields.
      for (const field of [
        "condition",
        "action",
        "expected_effect",
        "failure_class",
        "context",
        "kind",
        "appliesWhen",
      ]) {
        if (other[field] && !canonical[field]) canonical[field] = other[field];
      }
      if (canonical.condition && canonical.action && canonical.expected_effect) {
        canonical.lesson = `${canonical.action} (${canonical.expected_effect})`;
        canonical.solution = canonical.action;
        canonical.problem =
          canonical.problem ||
          canonical.condition ||
          other.problem ||
          null;
      }
      other.status = "deprecated";
      other.deprecated_reason = `merged_into:${canonical.id}`;
      other.deprecated_at = isoNow();
      deprecated.push(other.id);
      merged += 1;
      store.lessons[other.id] = other;
    }
    // Promotion stage bump when enough evidence.
    const observed = canonical.evidence?.observed_runs ?? 0;
    const conf = canonical.evidence?.confidence ?? 0;
    if (observed >= 5 && conf >= 0.35) {
      canonical.promotion_stage = "validated";
    } else if (observed >= 2) {
      canonical.promotion_stage = canonical.promotion_stage ?? "candidate";
    }
    store.lessons[canonical.id] = canonical;
  }

  store.updated_at = isoNow();
  return { merged, deprecated, clusters: clusters.size };
}

/**
 * Active-only view for retrieval corpora.
 */
export function activeLessonsOnly(store) {
  const out = {};
  for (const [id, lesson] of Object.entries(store.lessons ?? {})) {
    if (lesson?.status && lesson.status !== "active" && lesson.status !== "validated") {
      // keep validated as active for retrieval
      if (lesson.status === "deprecated") continue;
    }
    if (lesson?.status === "deprecated") continue;
    out[id] = lesson;
  }
  return out;
}
