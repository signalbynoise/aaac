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
  const structuredMeaning = [
    lesson.condition && `When ${lesson.condition}`,
    lesson.action,
    lesson.expected_effect && `Expect: ${lesson.expected_effect}`,
  ]
    .filter(Boolean)
    .join(". ");
  const meaning =
    structuredMeaning ||
    [lesson.lesson, lesson.problem].filter(Boolean).join(". ");
  const trigger = [
    lesson.failure_class && `failure: ${lesson.failure_class}`,
    lesson.context?.phase && `phase: ${lesson.context.phase}`,
    lesson.context?.artifact && `artifact: ${lesson.context.artifact}`,
    lesson.condition && `condition: ${lesson.condition}`,
    tags && `tags: ${tags}`,
    applies && `applies when: ${applies}`,
    lesson.problem,
  ]
    .filter(Boolean)
    .join(". ");
  const failure =
    lesson.failure_class ||
    lesson.problem ||
    lesson.condition ||
    lesson.lesson ||
    "";
  const remedy =
    lesson.action || lesson.solution || lesson.expected_effect || lesson.lesson || "";

  return {
    meaning: meaning || String(lesson.lesson ?? lesson.id ?? ""),
    trigger: trigger || meaning,
    failure: failure || meaning,
    remedy: remedy || meaning,
  };
}

export { VECTOR_SLOTS };
