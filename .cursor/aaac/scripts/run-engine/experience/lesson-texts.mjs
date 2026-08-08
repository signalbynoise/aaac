/**
 * Derive multi-vector slot texts from a lesson record.
 */
import { VECTOR_SLOTS } from "./paths.mjs";

/**
 * @param {object} lesson
 * @returns {Record<string, string>}
 */
export function deriveLessonSlotTexts(lesson) {
  const tags = (lesson.tags ?? []).join(", ");
  const applies = (lesson.appliesWhen ?? []).join("; ");
  const meaning = [lesson.lesson, lesson.problem].filter(Boolean).join(". ");
  const trigger = [
    tags && `tags: ${tags}`,
    applies && `applies when: ${applies}`,
    lesson.problem,
  ]
    .filter(Boolean)
    .join(". ");
  const failure = lesson.problem || lesson.lesson || "";
  const remedy = lesson.solution || lesson.lesson || "";

  return {
    meaning: meaning || String(lesson.lesson ?? lesson.id ?? ""),
    trigger: trigger || meaning,
    failure: failure || meaning,
    remedy: remedy || meaning,
  };
}

export { VECTOR_SLOTS };
