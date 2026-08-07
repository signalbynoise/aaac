/**
 * Conditional contradiction resolution for lessons.
 */

function textBlob(manifest) {
  return [
    manifest.verb,
    manifest.object,
    manifest.phase,
    manifest.domain,
    manifest.intent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesConditions(conditions, blob) {
  if (!conditions?.length) return false;
  return conditions.some((c) => blob.includes(String(c).toLowerCase()));
}

/**
 * @param {object} lesson
 * @param {object} manifest
 * @returns {{ applies: boolean, penalty: number, warning: string|null }}
 */
export function evaluateApplicability(lesson, manifest) {
  const blob = textBlob(manifest);
  const appliesWhen = lesson.appliesWhen ?? [];
  const doesNotApplyWhen = lesson.doesNotApplyWhen ?? [];

  if (matchesConditions(doesNotApplyWhen, blob)) {
    return {
      applies: false,
      penalty: 1,
      warning: `Skipped ${lesson.id}: does not apply under current task conditions`,
    };
  }
  if (appliesWhen.length && !matchesConditions(appliesWhen, blob)) {
    return {
      applies: true,
      penalty: 0.35,
      warning: null,
    };
  }
  return { applies: true, penalty: 0, warning: null };
}

/**
 * Given selected lessons and CONTRADICTS edges, demote losers.
 * @param {Array<{ lessonId: string, score: number, lesson: object }>} candidates
 * @param {Array<{ src_id: string, dst_id: string, type: string }>} edges
 * @param {object} manifest
 */
export function resolveContradictions(candidates, edges, manifest) {
  const contradictPairs = edges.filter((e) => e.type === "CONTRADICTS");
  const byId = new Map(candidates.map((c) => [c.lessonId, c]));
  const warnings = [];
  const penalty = new Map();

  for (const c of candidates) {
    const appl = evaluateApplicability(c.lesson, manifest);
    if (!appl.applies) {
      penalty.set(c.lessonId, 1);
      if (appl.warning) warnings.push(appl.warning);
    } else if (appl.penalty) {
      penalty.set(c.lessonId, Math.max(penalty.get(c.lessonId) ?? 0, appl.penalty));
    }
  }

  for (const edge of contradictPairs) {
    const a = byId.get(edge.src_id);
    const b = byId.get(edge.dst_id);
    if (!a || !b) continue;
    const aAppl = evaluateApplicability(a.lesson, manifest);
    const bAppl = evaluateApplicability(b.lesson, manifest);
    if (aAppl.penalty < bAppl.penalty) {
      penalty.set(b.lessonId, 1);
      warnings.push(`Prefer ${a.lessonId} over contradicting ${b.lessonId}`);
    } else if (bAppl.penalty < aAppl.penalty) {
      penalty.set(a.lessonId, 1);
      warnings.push(`Prefer ${b.lessonId} over contradicting ${a.lessonId}`);
    } else if (a.score >= b.score) {
      penalty.set(b.lessonId, Math.max(penalty.get(b.lessonId) ?? 0, 0.8));
      warnings.push(`Prefer higher-scoring ${a.lessonId} over ${b.lessonId}`);
    } else {
      penalty.set(a.lessonId, Math.max(penalty.get(a.lessonId) ?? 0, 0.8));
      warnings.push(`Prefer higher-scoring ${b.lessonId} over ${a.lessonId}`);
    }
  }

  return { penalty, warnings };
}
