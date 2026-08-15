/**
 * Write path: process a terminal Run into reflection + lessons + stats.
 * Prefer this from advance-phase / approve-run — not select/export.
 */
import fs from "fs";
import path from "path";
import { loadRunManifest, runDir, writeJson, isoNow, readJson } from "../lib.mjs";
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
import { extractFailures } from "./failures.mjs";
import { compileLessonsFromRun } from "./lesson-compiler.mjs";
import { consolidateLessonsStore } from "./consolidate.mjs";
import { loadArtifactCharWarn } from "./paths.mjs";
import {
  computeRunReward,
  updateLessonUtilities,
} from "./utility.mjs";
import { buildTrajectory } from "./trajectory.mjs";
import {
  loadStrategiesStore,
  saveStrategiesStore,
  upsertStrategyFromTrajectory,
} from "./strategy.mjs";
import { compressExperience } from "./compress.mjs";
import {
  loadRepoKnowledgeStore,
  saveRepoKnowledgeStore,
  learnRepoKnowledgeFromRun,
  writeRepoMapMarkdown,
} from "./repo-knowledge.mjs";
import { processRepoMemoryFromRun } from "./repo-learn.mjs";
import { processRetrievalMisses } from "../retrieval-miss.mjs";
import {
  loadProfilesStore,
  saveProfilesStore,
  updateExecutionProfile,
} from "./execution-profile.mjs";
import {
  emptyGraphPolicyStore,
  loadGraphPolicyStore,
  saveGraphPolicyStore,
  updateGraphPolicyFromTrajectory,
  DEFAULT_YAML_FLOORS,
} from "./graph-policy.mjs";
import { cacheArtifactsFromRun } from "./artifact-reuse.mjs";

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
  const artifactCharWarn = loadArtifactCharWarn();
  const failures = extractFailures(manifest, {
    artifactsDir,
    artifactCharWarn,
  });
  writeJson(path.join(artifactsDir, "failures.json"), {
    run_id: runId,
    prepared_at: isoNow(),
    artifact_char_warn: artifactCharWarn,
    failures,
  });

  const structured = compileLessonsFromRun(
    manifest,
    reflection,
    outcome,
    failures,
  );
  // Keep path/avoid hints from legacy extractor; skip generic rec-* prose when
  // a structured lesson already covers the same signal.
  const legacy = candidateLessonsFromRun(manifest, reflection, outcome).filter(
    (c) => {
      if (c.id?.startsWith("ignore-")) return true;
      if (structured.some((s) => s.id === c.id)) return false;
      if (c.id?.startsWith("rec-optimize-") && structured.length) return false;
      return !structured.some(
        (s) =>
          s.failure_class &&
          c.tags?.includes("runtime") &&
          s.context?.phase &&
          c.id?.includes(s.context.phase),
      );
    },
  );
  const candidates = [...structured, ...legacy];
  const byId = new Map();
  for (const c of candidates) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }

  const upserted = [];
  for (const candidate of byId.values()) {
    upserted.push(
      upsertLessonWithEvidence(lessonsStore, candidate, {
        runId,
        outcome,
        tokenSavingsPct,
        runtimeImprovementPct,
        contradicted:
          outcome.status === "failure" &&
          candidate.scope === "global" &&
          candidate.kind !== "structured",
      }),
    );
  }

  const consolidation = consolidateLessonsStore(lessonsStore);

  // V4 — trajectory capture
  const profileId =
    process.env.AAAC_EXECUTION_PROFILE ??
    readJson(path.join(artifactsDir, "execution_profile.json"), null)?.profile_id ??
    null;
  const trajectory = buildTrajectory(manifest, {
    artifactsDir,
    failures,
    profileId,
  });
  writeJson(path.join(artifactsDir, "trajectory.json"), trajectory);

  // Stage 4 — credit assignment / contextual utility
  // Prefer an existing learning-funnel.json (written by harness after agents).
  // If absent, compute reward now but defer utility updates so harnesses
  // don't double-count exposures when they write the funnel later.
  const funnelPath = path.join(artifactsDir, "learning-funnel.json");
  const funnel = readJson(funnelPath, null);
  const reward = computeRunReward({
    success: outcome.status === "success",
    tokens:
      manifest.metrics?.total_tokens ??
      manifest.metrics?.conversation_tokens ??
      null,
    baselineTokens: prior?.avg_tokens ?? statsPrior?.avg_tokens ?? null,
    durationMs: manifest.metrics?.duration_ms ?? null,
    baselineDurationMs:
      prior?.avg_duration_ms ?? statsPrior?.avg_duration_ms ?? null,
    gateFails: failures.length,
    filesRead: trajectory.files_read_total,
    baselineFilesRead: statsPrior?.avg_files_read ?? null,
    qualityOk: trajectory.quality?.ok ?? null,
  });
  const utilityUpdated = funnel
    ? updateLessonUtilities(lessonsStore, {
        manifest,
        funnel,
        reward,
      })
    : [];
  writeJson(path.join(artifactsDir, "run-reward.json"), {
    run_id: runId,
    reward,
    quality: trajectory.quality,
    files_read_total: trajectory.files_read_total,
    utility_updated: utilityUpdated,
    utility_deferred: !funnel,
    prepared_at: isoNow(),
  });

  // V4 — strategy upsert + compression + repo knowledge + profile update
  const strategiesStore = loadStrategiesStore();
  const strategyResult = upsertStrategyFromTrajectory(
    strategiesStore,
    trajectory,
    { lessons: upserted, profileId },
  );
  const compression = compressExperience({
    lessonsStore,
    strategiesStore,
    signature: key,
    strategyId: strategyResult.strategy?.id,
  });
  saveStrategiesStore(strategiesStore);
  writeJson(path.join(artifactsDir, "strategy-update.json"), {
    run_id: runId,
    prepared_at: isoNow(),
    ...strategyResult,
    compression,
  });

  const repoStore = loadRepoKnowledgeStore();
  const repoLearn = learnRepoKnowledgeFromRun(repoStore, {
    trajectory,
    lessons: upserted,
    manifest,
  });
  if (repoLearn.added.length) {
    writeRepoMapMarkdown(repoStore);
    saveRepoKnowledgeStore(repoStore);
  }

  // V6 — heal last-phase misses, then repo vector graph learn
  try {
    processRetrievalMisses(runId);
  } catch {
    // soft-fail — do not block experience write
  }

  let repoMemoryUpdate = null;
  try {
    repoMemoryUpdate = await processRepoMemoryFromRun({
      trajectory,
      manifest,
      artifactsDir,
      lessons: upserted,
      emit: true,
    });
    writeJson(path.join(artifactsDir, "repo-memory-update.json"), {
      run_id: runId,
      prepared_at: isoNow(),
      ...repoMemoryUpdate,
    });
  } catch (err) {
    repoMemoryUpdate = {
      ok: false,
      error: String(err?.message ?? err).slice(0, 200),
    };
  }

  let profileUpdate = null;
  if (profileId) {
    const profilesStore = loadProfilesStore();
    updateExecutionProfile(profilesStore, profileId, {
      reward,
      trajectory,
    });
    saveProfilesStore(profilesStore);
    profileUpdate = { profile_id: profileId, reward };
  }

  // V5 — graph policy + artifact cache
  let graphUpdate = null;
  try {
    const graphStore = loadGraphPolicyStore() ?? emptyGraphPolicyStore();
    graphUpdate = updateGraphPolicyFromTrajectory(
      graphStore,
      trajectory,
      manifest,
      { yamlFloors: DEFAULT_YAML_FLOORS },
    );
    saveGraphPolicyStore(graphStore);
    writeJson(path.join(artifactsDir, "graph-policy-update.json"), {
      run_id: runId,
      prepared_at: isoNow(),
      ...graphUpdate,
    });
  } catch (err) {
    graphUpdate = { error: String(err?.message ?? err).slice(0, 200) };
  }

  let artifactCache = null;
  try {
    artifactCache = cacheArtifactsFromRun(manifest, artifactsDir, {
      qualityOk: Boolean(trajectory.quality?.ok),
    });
    writeJson(path.join(artifactsDir, "artifact-cache-update.json"), {
      run_id: runId,
      prepared_at: isoNow(),
      ...artifactCache,
    });
  } catch (err) {
    artifactCache = { cached: false, error: String(err?.message ?? err).slice(0, 200) };
  }

  saveLessonsStore(lessonsStore);
  writeJson(path.join(artifactsDir, "lesson-consolidation.json"), {
    run_id: runId,
    prepared_at: isoNow(),
    ...consolidation,
    compression,
  });

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

  // Stage 3 — promotion ladder (may write knowledge/procedures.md)
  const promoted = promoteKnowledgeArtifacts(
    reflection,
    Object.values(lessonsStore.lessons ?? {}),
    lessonsStore,
  );
  saveLessonsStore(lessonsStore);

  // Stage 5 — update bandit arm when selected via env
  let banditUpdate = null;
  const armId = process.env.AAAC_BANDIT_ARM;
  if (armId) {
    try {
      const { loadBanditStore, saveBanditStore, updateBanditArm, armToEnv } =
        await import("./bandit.mjs");
      const store = loadBanditStore();
      updateBanditArm(store, armId, reward);
      saveBanditStore(store);
      const arm = store.arms[armId];
      banditUpdate = {
        arm_id: armId,
        reward,
        pulls: arm?.pulls ?? null,
        mean_reward:
          arm?.pulls > 0
            ? Math.round((arm.reward_sum / arm.pulls) * 1000) / 1000
            : null,
      };
      writeJson(path.join(artifactsDir, "learning-policy.json"), {
        run_id: runId,
        prepared_at: isoNow(),
        arm_id: armId,
        env: arm ? armToEnv(arm) : {},
        reward,
        bandit: banditUpdate,
      });
    } catch (err) {
      banditUpdate = {
        error: String(err?.message ?? err).slice(0, 300),
      };
    }
  } else {
    writeJson(path.join(artifactsDir, "learning-policy.json"), {
      run_id: runId,
      prepared_at: isoNow(),
      arm_id: null,
      env: {
        AAAC_FINAL_LESSONS: process.env.AAAC_FINAL_LESSONS ?? null,
        AAAC_MMR_LAMBDA: process.env.AAAC_MMR_LAMBDA ?? null,
        AAAC_ARTIFACT_WARN_RATIO: process.env.AAAC_ARTIFACT_WARN_RATIO ?? null,
        AAAC_ARTIFACT_CHAR_WARN: process.env.AAAC_ARTIFACT_CHAR_WARN ?? null,
      },
      reward,
    });
  }

  const experienceOutcomes = [
    { type: "reflection", path: "artifacts/reflection.json" },
    { type: "failures", path: "artifacts/failures.json", count: failures.length },
    {
      type: "trajectory",
      path: "artifacts/trajectory.json",
      quality_ok: trajectory.quality?.ok ?? false,
      files_read_total: trajectory.files_read_total,
      tokens: trajectory.tokens,
    },
    {
      type: "lesson_consolidation",
      path: "artifacts/lesson-consolidation.json",
      ...consolidation,
    },
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
      kind: l.kind ?? null,
      failure_class: l.failure_class ?? null,
      promotion_stage: l.promotion_stage ?? null,
      evidence: l.evidence,
    })),
    ...(indexResult?.ok
      ? [{ type: "experience_index_upserted", ...indexResult }]
      : indexResult
        ? [{ type: "experience_index_upsert_failed", error: indexResult.error }]
        : []),
    ...memoryAdded.map((id) => ({ type: "workspace_pref", id })),
    ...promoted.map((p) => ({ type: "knowledge_promoted", path: p.path })),
    ...(utilityUpdated.length
      ? [{ type: "utility_updated", lesson_ids: utilityUpdated, reward }]
      : []),
    ...(banditUpdate
      ? [{ type: "bandit_updated", ...banditUpdate }]
      : []),
    ...(strategyResult.updated
      ? [{
          type: "strategy_updated",
          strategy_id: strategyResult.strategy?.id,
          winner: strategyResult.winner,
        }]
      : []),
    ...(repoLearn.added.length
      ? [{ type: "repo_knowledge_updated", claim_ids: repoLearn.added }]
      : []),
    ...(repoMemoryUpdate?.ok
      ? [{ type: "repo_memory_updated", ...repoMemoryUpdate }]
      : repoMemoryUpdate?.error
        ? [{ type: "repo_memory_update_failed", error: repoMemoryUpdate.error }]
        : []),
    ...(profileUpdate
      ? [{ type: "execution_profile_updated", ...profileUpdate }]
      : []),
    ...(compression.deprecated_lesson_ids?.length
      ? [{
          type: "experience_compressed",
          deprecated: compression.deprecated_lesson_ids.length,
          active_after: compression.active_lesson_count_after,
        }]
      : []),
    ...(graphUpdate && !graphUpdate.error
      ? [{ type: "graph_policy_updated", ...graphUpdate }]
      : []),
    ...(artifactCache?.cached
      ? [{ type: "artifact_cache_updated", ...artifactCache }]
      : []),
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
      trajectory: "artifacts/trajectory.json",
    };
    manifest.trajectory = {
      path: "artifacts/trajectory.json",
      quality_ok: trajectory.quality?.ok ?? false,
      files_read_total: trajectory.files_read_total,
      tokens: trajectory.tokens,
      profile_id: profileId,
    };
    manifest.updated_at = isoNow();
    writeJson(path.join(runDir(runId), "run.json"), manifest);
  }

  return result;
}
