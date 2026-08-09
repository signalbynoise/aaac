/**
 * V4 — Experience compression: many lessons/observations → fewer strategies + skips.
 */

import { isoNow } from "../lib.mjs";

/**
 * Compress lesson corpus into skip/focus hints for a signature.
 * Deprecates near-duplicate low-confidence lessons when a strategy exists.
 */
export function compressExperience({
  lessonsStore,
  strategiesStore,
  signature,
  strategyId,
}) {
  const strategy = strategiesStore?.strategies?.[strategyId] ?? null;
  const compressed = {
    prepared_at: isoNow(),
    signature,
    strategy_id: strategyId ?? null,
    deprecated_lesson_ids: [],
    merged_skip_hints: [],
    active_lesson_count_before: 0,
    active_lesson_count_after: 0,
  };

  const lessons = Object.values(lessonsStore?.lessons ?? {}).filter(
    (l) => l.status !== "deprecated",
  );
  compressed.active_lesson_count_before = lessons.length;

  if (!strategy) {
    compressed.active_lesson_count_after = lessons.length;
    return compressed;
  }

  const skipHints = new Set(strategy.usually_not_needed ?? []);
  for (const lesson of lessons) {
    for (const p of lesson.avoid_paths ?? []) {
      skipHints.add(`path:${p}`);
    }
  }
  compressed.merged_skip_hints = [...skipHints].slice(0, 24);
  strategy.usually_not_needed = compressed.merged_skip_hints;
  strategiesStore.strategies[strategy.id] = strategy;

  // Deprecate low-confidence unstructured duplicates once strategy is confident
  if ((strategy.confidence ?? 0) >= 0.5 && (strategy.evidence?.runs ?? 0) >= 3) {
    for (const lesson of lessons) {
      if (lesson.kind === "structured") continue;
      if ((lesson.evidence?.confidence ?? 0) >= 0.5) continue;
      if ((lesson.evidence?.observed_runs ?? 0) >= 4) continue;
      // Soft-deprecate generic rec-* prose that strategy covers
      if (
        String(lesson.id ?? "").startsWith("rec-") ||
        String(lesson.lesson ?? "").length > 280
      ) {
        lesson.status = "deprecated";
        lesson.deprecated_reason = "compressed_into_strategy";
        lesson.compressed_into = strategy.id;
        lessonsStore.lessons[lesson.id] = lesson;
        compressed.deprecated_lesson_ids.push(lesson.id);
      }
    }
  }

  compressed.active_lesson_count_after = Object.values(
    lessonsStore.lessons ?? {},
  ).filter((l) => l.status !== "deprecated").length;

  return compressed;
}
