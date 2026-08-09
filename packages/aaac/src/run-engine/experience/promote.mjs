/**
 * Promote durable lessons to knowledge/ + workspace memory.
 * Stage 3: procedures via promotion ladder; pitfalls remain high-confidence tips.
 */
import fs from "fs";
import path from "path";
import { isoNow } from "../lib.mjs";
import { ARTIFACT_PROMOTE_MIN_CONFIDENCE, KNOWLEDGE_ROOT } from "./paths.mjs";
import { applyPromotionLadder } from "./promotion.mjs";

export function promoteKnowledgeArtifacts(_reflection, lessonEntries, lessonsStore = null) {
  const promoted = [];

  if (lessonsStore) {
    const ladder = applyPromotionLadder(lessonsStore);
    if (ladder.procedures_path) {
      promoted.push({
        path: ladder.procedures_path,
        lessons: ladder.procedure_ids,
        kind: "procedures",
        advanced: ladder.advanced,
      });
    }
  }

  const durable = lessonEntries.filter(
    (l) =>
      (l.evidence?.confidence ?? 0) >= ARTIFACT_PROMOTE_MIN_CONFIDENCE ||
      l.promotion_stage === "procedure",
  );
  if (!durable.length) return promoted;

  fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
  const pitfallsPath = path.join(KNOWLEDGE_ROOT, "pitfalls.md");
  const lines = [
    "# AAAC pitfalls (auto-promoted)",
    "",
    `Updated: ${isoNow()}`,
    "",
  ];
  for (const lesson of durable) {
    const e = lesson.evidence;
    lines.push(`## ${lesson.lesson}`);
    lines.push("");
    if (lesson.condition) lines.push(`When: ${lesson.condition}`);
    if (lesson.action) lines.push(`Do: ${lesson.action}`);
    if (lesson.expected_effect) lines.push(`Expect: ${lesson.expected_effect}`);
    lines.push(
      `Evidence: ${e.observed_runs} runs, ${e.successful_runs} successful, confidence ${e.confidence}`,
    );
    if (lesson.solution) lines.push(`Solution: ${lesson.solution}`);
    lines.push(`Stage: ${lesson.promotion_stage ?? "candidate"}`);
    lines.push("");
  }
  fs.writeFileSync(pitfallsPath, `${lines.join("\n")}\n`);
  promoted.push({ path: pitfallsPath, lessons: durable.map((d) => d.id), kind: "pitfalls" });
  return promoted;
}

export function maybeUpdateWorkspaceMemory(memoryStore, lessonEntries, outcome) {
  if (outcome.status !== "success") return [];
  const added = [];
  for (const lesson of lessonEntries) {
    const stage = lesson.promotion_stage ?? "candidate";
    if (
      (lesson.evidence?.confidence ?? 0) < ARTIFACT_PROMOTE_MIN_CONFIDENCE &&
      stage !== "procedure" &&
      stage !== "validated"
    ) {
      continue;
    }
    if (!(lesson.avoid_paths ?? []).length) continue;
    const prefKey = `avoid:${lesson.id}`;
    const exists = (memoryStore.prefs ?? []).some((p) => p.id === prefKey);
    if (exists) continue;
    memoryStore.prefs.push({
      id: prefKey,
      visibility: "project",
      text: lesson.lesson,
      avoid_paths: lesson.avoid_paths,
      evidence: {
        observed_runs: lesson.evidence.observed_runs,
        confidence: lesson.evidence.confidence,
      },
      updated_at: isoNow(),
    });
    added.push(prefKey);
  }
  return added;
}
