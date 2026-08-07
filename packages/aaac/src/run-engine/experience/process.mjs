/**
 * Write path: process a terminal Run into reflection + lessons + stats.
 * Prefer this from advance-phase / approve-run — not select/export.
 */
import fs from "fs";
import path from "path";
import { loadRunManifest, runDir, writeJson, isoNow } from "../lib.mjs";
import { pctImprovement } from "./math.mjs";
import { deriveOutcome } from "./outcome.mjs";
import { buildReflection } from "./reflection.mjs";
import { signatureKey, updateExperienceStats } from "./stats.mjs";
import {
  loadExperienceStats,
  saveExperienceStats,
  loadLessonsStore,
  saveLessonsStore,
  loadWorkspaceMemory,
  saveWorkspaceMemory,
  loadPackagedGlobalLessons,
  mergeLessonCorpora,
} from "./stores.mjs";
import { candidateLessonsFromRun, upsertLessonWithEvidence } from "./lessons.mjs";
import { promoteKnowledgeArtifacts, maybeUpdateWorkspaceMemory } from "./promote.mjs";
import { upsertLessonsIntoIndex } from "./index/build.mjs";

export async function processRunExperience(runId, options = {}) {
  const manifest = options.manifest ?? loadRunManifest(runId);
  if (!manifest) {
    return { ok: false, error: `Run not found: ${runId}` };
  }

  if (manifest.experience_processed && !options.force) {
    return { ok: true, skipped: true, reason: "already_processed" };
  }

  const terminal =
    manifest.status === "completed" ||
    manifest.status === "failed" ||
    manifest.status === "cancelled";
  if (!terminal && !options.force) {
    return { ok: true, skipped: true, reason: "not_terminal" };
  }

  const artifactsDir = path.join(runDir(runId), "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  const outcome = deriveOutcome(manifest);
  const statsStore = loadExperienceStats();
  const key = signatureKey(manifest);
  const statsPrior = statsStore.signatures?.[key]
    ? { ...statsStore.signatures[key] }
    : null;

  const reflection = buildReflection(manifest, outcome, statsPrior);
  writeJson(path.join(artifactsDir, "reflection.json"), {
    ...reflection,
    run_id: runId,
    prepared_at: isoNow(),
  });

  const { prior, entry: statsEntry } = updateExperienceStats(
    statsStore,
    manifest,
    outcome,
  );
  saveExperienceStats(statsStore);

  const tokenSavingsPct = pctImprovement(
    prior?.avg_tokens ?? statsPrior?.avg_tokens,
    manifest.metrics?.total_tokens ?? manifest.metrics?.conversation_tokens,
  );
  const runtimeImprovementPct = pctImprovement(
    prior?.avg_duration_ms ?? statsPrior?.avg_duration_ms,
    manifest.metrics?.duration_ms,
  );

  const lessonsStore = loadLessonsStore();
  const candidates = candidateLessonsFromRun(manifest, reflection, outcome);
  const upserted = [];
  for (const candidate of candidates) {
    upserted.push(
      upsertLessonWithEvidence(lessonsStore, candidate, {
        runId,
        outcome,
        tokenSavingsPct,
        runtimeImprovementPct,
        contradicted: outcome.status === "failure" && candidate.scope === "global",
      }),
    );
  }
  saveLessonsStore(lessonsStore);

  let indexResult = null;
  try {
    const merged = mergeLessonCorpora(loadPackagedGlobalLessons(), lessonsStore);
    const changedIds = upserted.map((l) => l.id);
    indexResult = await upsertLessonsIntoIndex(merged, {
      lessonIds: changedIds.length ? changedIds : undefined,
    });
  } catch (err) {
    indexResult = {
      ok: false,
      error: String(err?.message ?? err).slice(0, 300),
    };
  }

  const memoryStore = loadWorkspaceMemory();
  const memoryAdded = maybeUpdateWorkspaceMemory(memoryStore, upserted, outcome);
  if (memoryAdded.length) saveWorkspaceMemory(memoryStore);

  const promoted = promoteKnowledgeArtifacts(reflection, upserted);

  const experienceOutcomes = [
    { type: "reflection", path: "artifacts/reflection.json" },
    {
      type: "stats",
      signature: key,
      runs: statsEntry.runs,
      success_rate:
        statsEntry.runs > 0
          ? Math.round((statsEntry.successes / statsEntry.runs) * 1000) / 1000
          : null,
    },
    ...upserted.map((l) => ({
      type: "lesson_upserted",
      lesson_id: l.id,
      evidence: l.evidence,
    })),
    ...(indexResult?.ok
      ? [{ type: "experience_index_upserted", ...indexResult }]
      : indexResult
        ? [{ type: "experience_index_upsert_failed", error: indexResult.error }]
        : []),
    ...memoryAdded.map((id) => ({ type: "workspace_pref", id })),
    ...promoted.map((p) => ({ type: "knowledge_promoted", path: p.path })),
  ];

  const result = {
    ok: true,
    run_id: runId,
    outcome,
    reflection,
    lessons: upserted.map((l) => ({
      id: l.id,
      lesson: l.lesson,
      evidence: l.evidence,
    })),
    experience_outcomes: experienceOutcomes,
  };

  if (!options.skipManifestWrite) {
    manifest.outcome = {
      status: outcome.status,
      quality: outcome.quality,
      gate_retries: outcome.gate_retries,
      rollback_used: outcome.rollback_used,
      human_interventions: outcome.human_interventions,
    };
    manifest.reflection = {
      path: "artifacts/reflection.json",
      goal_achieved: reflection.goal_achieved,
      largest_bottleneck: reflection.largest_bottleneck,
      biggest_waste: reflection.biggest_waste,
      most_valuable_artifact: reflection.most_valuable_artifact,
      reusable_lesson: reflection.reusable_lesson,
      recommendation: reflection.recommendation,
      confidence: reflection.confidence,
    };
    manifest.lessons = result.lessons;
    manifest.experience_processed = true;
    manifest.experience_outcomes = experienceOutcomes;
    manifest.artifacts = {
      ...(manifest.artifacts ?? {}),
      reflection: "artifacts/reflection.json",
    };
    manifest.updated_at = isoNow();
    writeJson(path.join(runDir(runId), "run.json"), manifest);
  }

  return result;
}
