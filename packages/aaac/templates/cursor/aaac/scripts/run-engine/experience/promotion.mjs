/**
 * Stage 3 — Promotion ladder:
 *   candidate → validated → procedure (durable operating knowledge)
 *
 * Procedures are written to knowledge/procedures.md — NOT swarm skill files —
 * so one-off observations cannot corrupt instructions.
 */

import fs from "fs";
import path from "path";
import { isoNow } from "../lib.mjs";
import {
  KNOWLEDGE_ROOT,
  PROMOTE_MIN_CONFIDENCE,
  PROMOTE_MIN_OBSERVED,
} from "./paths.mjs";

export const PROMOTION_STAGES = ["candidate", "validated", "procedure"];

export function evaluatePromotionStage(lesson) {
  const observed = lesson.evidence?.observed_runs ?? 0;
  const confidence = lesson.evidence?.confidence ?? 0;
  const successful = lesson.evidence?.successful_runs ?? 0;
  const failed = lesson.evidence?.failed_runs ?? 0;
  const utilityHelped = Object.values(lesson.utility_by_context ?? {}).reduce(
    (s, u) => s + (u.helped ?? 0),
    0,
  );
  const utilityHarmed = Object.values(lesson.utility_by_context ?? {}).reduce(
    (s, u) => s + (u.harmed ?? 0),
    0,
  );

  const current = lesson.promotion_stage ?? "candidate";
  if (lesson.status === "deprecated") return "candidate";

  // Procedure: strong evidence + helped more than harmed + structured preferred
  if (
    observed >= PROMOTE_MIN_OBSERVED &&
    confidence >= PROMOTE_MIN_CONFIDENCE &&
    successful >= Math.ceil(PROMOTE_MIN_OBSERVED * 0.6) &&
    utilityHelped >= utilityHarmed + 2 &&
    (lesson.kind === "structured" || lesson.failure_class)
  ) {
    return "procedure";
  }

  // Validated: repeated useful signal
  if (
    observed >= 3 &&
    confidence >= 0.25 &&
    successful + utilityHelped > failed + utilityHarmed
  ) {
    return "validated";
  }

  if (current === "procedure" || current === "validated") {
    // Don't demote automatically unless contradicted heavily
    if ((lesson.evidence?.contradicted_runs ?? 0) >= 3 && confidence < 0.2) {
      return "candidate";
    }
    return current === "procedure" ? "validated" : current;
  }

  return "candidate";
}

/**
 * Advance promotion_stage on all active lessons; write procedures.md for procedure-stage.
 * @returns {{ advanced: string[], procedures_path: string|null, procedure_ids: string[] }}
 */
export function applyPromotionLadder(lessonsStore) {
  const advanced = [];
  const procedureLessons = [];

  for (const lesson of Object.values(lessonsStore.lessons ?? {})) {
    if (lesson.status === "deprecated") continue;
    const next = evaluatePromotionStage(lesson);
    if (next !== (lesson.promotion_stage ?? "candidate")) {
      advanced.push(`${lesson.id}:${lesson.promotion_stage ?? "candidate"}→${next}`);
      lesson.promotion_stage = next;
      lesson.promoted_at = isoNow();
    } else {
      lesson.promotion_stage = next;
    }
    if (next === "procedure") procedureLessons.push(lesson);
    lessonsStore.lessons[lesson.id] = lesson;
  }

  let proceduresPath = null;
  if (procedureLessons.length) {
    fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
    proceduresPath = path.join(KNOWLEDGE_ROOT, "procedures.md");
    const lines = [
      "# AAAC procedures (promoted experience)",
      "",
      "Durable operating procedures promoted from validated lessons.",
      "These do **not** auto-edit swarm skill files — orchestrators should read this file.",
      "",
      `Updated: ${isoNow()}`,
      "",
    ];
    for (const lesson of procedureLessons.sort(
      (a, b) => (b.evidence?.confidence ?? 0) - (a.evidence?.confidence ?? 0),
    )) {
      lines.push(`## ${lesson.id}`);
      lines.push("");
      if (lesson.failure_class) lines.push(`- **Failure class:** ${lesson.failure_class}`);
      if (lesson.condition) lines.push(`- **When:** ${lesson.condition}`);
      if (lesson.action) lines.push(`- **Do:** ${lesson.action}`);
      if (lesson.expected_effect) {
        lines.push(`- **Expect:** ${lesson.expected_effect}`);
      }
      lines.push(`- **Lesson:** ${lesson.lesson}`);
      const e = lesson.evidence ?? {};
      lines.push(
        `- **Evidence:** ${e.observed_runs ?? 0} runs, ${e.successful_runs ?? 0} successful, confidence ${e.confidence ?? 0}`,
      );
      lines.push(`- **Stage:** procedure`);
      lines.push("");
    }
    fs.writeFileSync(proceduresPath, `${lines.join("\n")}\n`);
  }

  return {
    advanced,
    procedures_path: proceduresPath,
    procedure_ids: procedureLessons.map((l) => l.id),
  };
}
