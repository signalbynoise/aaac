/**
 * Promote durable lessons to knowledge/ + workspace memory.
 */
import fs from "fs";
import path from "path";
import { isoNow } from "../lib.mjs";
import { ARTIFACT_PROMOTE_MIN_CONFIDENCE, KNOWLEDGE_ROOT } from "./paths.mjs";

export function promoteKnowledgeArtifacts(_reflection, lessonEntries) {
  const durable = lessonEntries.filter(
    (l) => (l.evidence?.confidence ?? 0) >= ARTIFACT_PROMOTE_MIN_CONFIDENCE,
  );
  if (!durable.length) return [];

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
    lines.push(
      `Evidence: ${e.observed_runs} runs, ${e.successful_runs} successful, confidence ${e.confidence}`,
    );
    if (lesson.solution) lines.push(`Solution: ${lesson.solution}`);
    lines.push("");
  }
  fs.writeFileSync(pitfallsPath, `${lines.join("\n")}\n`);
  return [{ path: pitfallsPath, lessons: durable.map((d) => d.id) }];
}

export function maybeUpdateWorkspaceMemory(memoryStore, lessonEntries, outcome) {
  if (outcome.status !== "success") return [];
  const added = [];
  for (const lesson of lessonEntries) {
    if ((lesson.evidence?.confidence ?? 0) < ARTIFACT_PROMOTE_MIN_CONFIDENCE) continue;
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
