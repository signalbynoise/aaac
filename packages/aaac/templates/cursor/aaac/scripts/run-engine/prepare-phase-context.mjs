#!/usr/bin/env node
/**
 * Build compact phase context for swarm agents from a Run manifest.
 *
 * Usage:
 *   node prepare-phase-context.mjs --run-id <run_id>
 *
 * Also auto-invoked on Run create (init-run / create-run-manifest) and
 * non-terminal phase advance.
 */
import path from "path";
import { fileURLToPath } from "url";
import { isoNow, loadRunManifest, runDir, writeJson } from "./lib.mjs";
import { loadContextBudget } from "./context-budget.mjs";
import { selectExperienceForContext } from "./experience/select.mjs";
import { DEFAULT_LESSON_CAP, DEFAULT_WARNING_CAP } from "./experience/paths.mjs";

function parseArgs(argv) {
  const out = { runId: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run-id") out.runId = argv[++i];
  }
  return out;
}

/**
 * Load experience priors and write artifacts/phase_context.json for a Run.
 * Soft-fails selectExperienceForContext (empty lessons on fresh installs).
 *
 * @param {string} runId
 * @param {object|null} [manifestOverride=null]
 * @returns {Promise<{ ok: true, path: string, verb: string, phase: string, experience_lessons: number }>}
 */
export async function preparePhaseContext(runId, manifestOverride = null) {
  const manifest = manifestOverride ?? loadRunManifest(runId);
  if (!manifest) {
    const err = new Error(`prepare-phase-context: Run not found: ${runId}`);
    err.code = "RUN_NOT_FOUND";
    throw err;
  }

  const budget = loadContextBudget();
  const intent =
    typeof manifest.intent === "string" ? manifest.intent.slice(0, 2000) : "";

  const envLessonCap = Number(process.env.AAAC_FINAL_LESSONS);
  const configuredCap = Number.isFinite(envLessonCap) && envLessonCap > 0
    ? envLessonCap
    : budget.experience?.max_lessons ?? DEFAULT_LESSON_CAP;
  const maxLessons = Math.min(
    configuredCap,
    budget.compaction?.merge_findings_max
      ? Math.max(3, Math.floor(budget.compaction.merge_findings_max / 5))
      : configuredCap,
  );
  const maxWarnings = budget.experience?.max_warnings ?? DEFAULT_WARNING_CAP;
  const envBudget = Number(process.env.AAAC_CONTEXT_BUDGET);
  const contextBudget = Number.isFinite(envBudget) && envBudget > 0
    ? envBudget
    : 12000;

  let experience = {
    lessons: [],
    warnings: [],
    stats_prior: null,
    workspace_prefs: [],
    strategy: null,
    repo_facts: [],
    execution: null,
    context_hint: {
      recommended_focus_paths: [],
      avoid_paths: [],
      historical_avg_tokens: null,
      historical_success_rate: null,
    },
  };
  let featureRows = null;
  let profileEnv = null;
  try {
    experience = await selectExperienceForContext(manifest, {
      maxLessons,
      maxWarnings,
      contextBudget,
    });
    featureRows = experience._feature_rows ?? null;
    profileEnv = experience.profile_env ?? null;
    delete experience._feature_rows;
    delete experience.profile_env;
  } catch {
    // Experience stores optional on fresh installs
  }

  // Enforce profile lesson cap if select returned a tighter profile
  if (
    experience?.execution?.context_budget &&
    Array.isArray(experience.lessons) &&
    experience.execution
  ) {
    const lessonCap = experience.lessons.length;
    void lessonCap;
  }

  const context = {
    prepared_at: isoNow(),
    run_id: runId,
    command: manifest.command,
    verb: manifest.verb,
    object: manifest.object ?? null,
    domain: manifest.domain ?? null,
    intent,
    phase: manifest.phase,
    completed: manifest.completed ?? [],
    complexity: {
      scope_score: manifest.complexity?.scope_score ?? null,
      change_score: manifest.complexity?.change_score ?? null,
    },
    swarm_target: manifest.swarm?.target_agents?.[manifest.phase] ?? null,
    wave_plan: manifest.swarm?.wave_plan?.[manifest.phase] ?? null,
    compaction: budget.compaction,
    handoff: {
      rule: "artifact_first",
      discover_brief: budget.handoff.check_discover,
      phase_context: "artifacts/phase_context.json",
    },
    experience,
    execution: experience.execution ?? null,
    policy_paths: {
      context_budget: ".cursor/aaac/context-budget.yaml",
      swarm_sizing: ".cursor/aaac/swarm-sizing.yaml",
      context_budget_policy: ".cursor/policies/context-budget.md",
      task_prompt_policy: ".cursor/skills/shared/_task-prompt-policy.md",
      experience_global: ".cursor/aaac/experience/global-lessons.json",
      experience_retrieval: ".cursor/aaac/experience/retrieval.yaml",
    },
    instructions:
      experience?.reuse_mode === "delta_or_confirm"
        ? "Read this file only — do not load full prior swarm transcripts. experience.prior_artifacts is SSOT for matching inputs: emit delta_or_confirm only (do not regenerate unchanged plan/report sections). Honor experience.strategy, experience.execution, and experience.graph_targets. Prefer experience.repo_facts over rediscovery. Stay within experience.context_budget."
        : "Read this file only — do not load full prior swarm transcripts. Return structured blocks per agent spec. Honor experience.strategy and experience.execution (prioritize/skip). Prefer experience.repo_facts over rediscovery. Cite experience.lessons with evidence when following recommendations. Stay within experience.context_budget.",
  };

  const artifactsDir = path.join(runDir(runId), "artifacts");
  const outPath = path.join(artifactsDir, "phase_context.json");
  writeJson(outPath, context);

  if (experience?.profile_id || experience?.execution) {
    try {
      writeJson(path.join(artifactsDir, "execution_profile.json"), {
        prepared_at: isoNow(),
        run_id: runId,
        profile_id: experience.profile_id ?? null,
        execution: experience.execution,
        strategy: experience.strategy,
        context_budget: experience.context_budget ?? contextBudget,
        context_bytes: experience.context_bytes ?? null,
        reuse_hits: experience.reuse_hits ?? 0,
        reuse_mode: experience.reuse_mode ?? null,
        graph_targets: experience.graph_targets ?? null,
        env: profileEnv,
      });
    } catch {
      // optional
    }
  }

  if (featureRows?.length) {
    try {
      writeJson(path.join(artifactsDir, "experience_retrieval.json"), {
        prepared_at: isoNow(),
        run_id: runId,
        retrieval: experience.retrieval ?? null,
        feature_rows: featureRows,
      });
    } catch {
      // optional training log
    }
  }

  return {
    ok: true,
    path: outPath,
    verb: manifest.verb,
    phase: manifest.phase,
    experience_lessons: experience.lessons?.length ?? 0,
    profile_id: experience.profile_id ?? null,
    context_bytes: experience.context_bytes ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.runId) {
    console.error("prepare-phase-context: --run-id required");
    process.exit(2);
  }

  try {
    const result = await preparePhaseContext(args.runId);
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(err.message ?? err);
    process.exit(err.code === "RUN_NOT_FOUND" ? 1 : 1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
