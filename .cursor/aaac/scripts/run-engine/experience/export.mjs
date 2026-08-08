/**
 * Export sanitize + candidate selection for npm corpus promotion.
 */
import { loadLessonsStore } from "./stores.mjs";
import { PROMOTE_MIN_OBSERVED, PROMOTE_MIN_CONFIDENCE } from "./paths.mjs";

export function sanitizeLessonForPackage(lesson) {
  if (!lesson?.evidence) return null;
  const { supporting_run_ids: _ids, ...rest } = lesson;
  return {
    ...rest,
    scope: "global",
    evidence: {
      ...lesson.evidence,
      last_run_id: null,
    },
    supporting_run_ids: [],
  };
}

export function exportGlobalLessonCandidates(options = {}) {
  const minObserved = options.minObserved ?? PROMOTE_MIN_OBSERVED;
  const minConfidence = options.minConfidence ?? PROMOTE_MIN_CONFIDENCE;
  const store = loadLessonsStore();
  const candidates = [];

  for (const lesson of Object.values(store.lessons ?? {})) {
    const e = lesson.evidence;
    if (!e) continue;
    if (lesson.status && lesson.status !== "active") continue;
    if ((e.observed_runs ?? 0) < minObserved) continue;
    if ((e.confidence ?? 0) < minConfidence) continue;
    const projectOnly =
      lesson.scope === "project" &&
      !(lesson.avoid_paths ?? []).length &&
      !(lesson.tags ?? []).includes("context");
    if (projectOnly && lesson.scope !== "global") continue;

    const sanitized = sanitizeLessonForPackage(lesson);
    if (sanitized) {
      candidates.push({
        ...sanitized,
        export_reason: `observed_runs=${e.observed_runs} confidence=${e.confidence}`,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      (b.evidence.confidence ?? 0) * (b.evidence.observed_runs ?? 0) -
      (a.evidence.confidence ?? 0) * (a.evidence.observed_runs ?? 0),
  );
  return candidates;
}
