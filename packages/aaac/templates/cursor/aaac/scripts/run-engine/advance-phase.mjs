#!/usr/bin/env node
/**
 * Advance Run to next phase. Validates swarm counts + required artifacts.
 * Usage: node advance-phase.mjs <run_id> <completed_phase> [--force]
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import {
  loadRegistry,
  loadEnforcement,
  loadRunManifest,
  runDir,
  isoNow,
  phaseKind,
  isEditPhase,
  isGatePhase,
  resolveSwarmMinimum,
  validatePhaseArtifactContent,
  normalizePhaseArtifactPath,
  writeJson,
  saveActiveRun,
} from "./lib.mjs";
import {
  resolvePhaseArtifacts,
  validateContextBudgetArtifacts,
  recordPhaseContextTelemetry,
  formatPhaseMetricsDetail,
} from "./context-budget.mjs";
import {
  archivePhaseSwarm,
  finalizeRunMetrics,
  computePhaseDurationMs,
} from "./swarm-telemetry.mjs";
import { recordLog } from "./log.mjs";
import { syncRunSidecars } from "./reconcile-run-status.mjs";
import {
  runPhaseComplexityHooks,
  applyNextPhaseSwarmTarget,
} from "./swarm-sizing-hooks.mjs";
import { resolveSwarmTargetDetail } from "./resolve-swarm-target.mjs";
import {
  processRunEvidence,
  evaluateCapabilityRuntimePolicy,
  resolveCapabilitiesWithRuntime,
  loadObjectMaturity,
} from "./capability-evidence.mjs";
import { processRunExperience } from "./experience/process.mjs";
import { preparePhaseContext } from "./prepare-phase-context.mjs";
import { writeStageSummary } from "./write-stage-summary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runId = process.argv[2];
const completedPhase = process.argv[3];
const force = process.argv.includes("--force");

if (!runId || !completedPhase) {
  console.error("Usage: advance-phase.mjs <run_id> <completed_phase> [--force]");
  process.exit(1);
}

const registry = loadRegistry();
const enforcement = loadEnforcement();
const manifestPath = path.join(runDir(runId), "run.json");
const manifest = loadRunManifest(runId);

if (!manifest) {
  console.error(`Run not found: ${runId}`);
  process.exit(1);
}

if (manifest.phase !== completedPhase) {
  if (manifest.completed?.includes(completedPhase)) {
    recordLog(manifest, {
      event: "phase_already_completed",
      phase: manifest.phase,
      phase_kind: manifest.phase_kind,
      detail: `skipped advance: ${completedPhase} already completed (current=${manifest.phase})`,
      level: "info",
    });
    manifest.updated_at = isoNow();
    writeJson(manifestPath, manifest);
    console.log(
      JSON.stringify({
        ok: true,
        run_id: runId,
        completed: completedPhase,
        phase: manifest.phase,
        status: manifest.status,
        edit_allowed: manifest.enforcement?.edit_allowed ?? false,
        already_completed: true,
      }),
    );
    process.exit(0);
  }
  console.error(
    `Phase mismatch: current=${manifest.phase} completed=${completedPhase}`,
  );
  process.exit(1);
}

const minAgents =
  manifest.swarm?.target_agents?.[completedPhase] ??
  resolveSwarmMinimum(completedPhase, manifest, enforcement);
const targetDetail = resolveSwarmTargetDetail(completedPhase, manifest, enforcement);
const launches = manifest.swarm?.task_launches_this_phase ?? 0;
if (minAgents && launches < minAgents && !force) {
  recordLog(manifest, {
    event: "gate_fail",
    phase: completedPhase,
    phase_kind: manifest.phase_kind,
    detail: `swarm incomplete: ${launches}/${minAgents} agents`,
    level: "warn",
  });
  manifest.updated_at = isoNow();
  writeJson(manifestPath, manifest);
  console.error(
    `Swarm incomplete: phase ${completedPhase} requires ${minAgents} Task agents, got ${launches}. Launch parallel Task subagents first.`,
  );
  process.exit(2);
}

if (!force) {
  const complexityHook = runPhaseComplexityHooks(runId, completedPhase, manifest);
  if (!complexityHook.ok) {
    recordLog(manifest, {
      event: "gate_fail",
      phase: completedPhase,
      phase_kind: manifest.phase_kind,
      detail: complexityHook.reason,
      level: "warn",
    });
    manifest.updated_at = isoNow();
    writeJson(manifestPath, manifest);
    console.error(complexityHook.reason);
    process.exit(2);
  }
  const refreshed = loadRunManifest(runId);
  if (refreshed) {
    Object.assign(manifest, refreshed);
  }
}

const verifyVerbs = enforcement.verify_verbs ?? ["create", "update", "fix"];
if (
  completedPhase === "verify" &&
  verifyVerbs.includes(manifest.verb) &&
  !force
) {
  const verifyScript = path.join(__dirname, "verify-website-build.mjs");
  const verifyRun = spawnSync("node", [verifyScript, "--run-id", runId], {
    encoding: "utf8",
  });
  if (verifyRun.status !== 0) {
    const detail =
      verifyRun.stderr?.trim() ||
      verifyRun.stdout?.trim() ||
      "verify-website-build failed";
    recordLog(manifest, {
      event: "gate_fail",
      phase: completedPhase,
      phase_kind: manifest.phase_kind,
      detail: `website verify failed: ${detail.slice(0, 500)}`,
      level: "warn",
    });
    manifest.updated_at = isoNow();
    writeJson(manifestPath, manifest);
    console.error(
      "App verify failed (see project.config.json verify). Fix errors, then re-run:\n" +
        `  node .cursor/aaac/scripts/run-engine/verify-website-build.mjs --run-id ${runId}\n` +
        detail,
    );
    process.exit(2);
  }
  recordLog(manifest, {
    event: "verify_website_pass",
    phase: completedPhase,
    phase_kind: manifest.phase_kind,
    detail: "app verify gate",
    level: "info",
  });
}

const requiredArtifacts = resolvePhaseArtifacts(completedPhase, manifest, enforcement);
for (const rel of requiredArtifacts) {
  const resolved = normalizePhaseArtifactPath(runId, rel, enforcement);
  if (!resolved.ok) {
    recordLog(manifest, {
      event: "gate_fail",
      phase: completedPhase,
      phase_kind: manifest.phase_kind,
      detail: `missing artifact: ${rel}`,
      level: "warn",
    });
    manifest.updated_at = isoNow();
    writeJson(manifestPath, manifest);
    console.error(`Missing artifact: ${rel} (required before leaving ${completedPhase})`);
    process.exit(2);
  }
  if (resolved.normalized_from) {
    recordLog(manifest, {
      event: "artifact_normalized",
      phase: completedPhase,
      phase_kind: manifest.phase_kind,
      detail: `${resolved.normalized_from} → ${rel}`,
      level: "info",
    });
  }
}

if (!force) {
  const contentGate = validatePhaseArtifactContent(
    runId,
    completedPhase,
    manifest,
    enforcement,
  );
  if (!contentGate.ok) {
    recordLog(manifest, {
      event: "gate_fail",
      phase: completedPhase,
      phase_kind: manifest.phase_kind,
      detail: contentGate.reason,
      level: "warn",
    });
    manifest.updated_at = isoNow();
    writeJson(manifestPath, manifest);
    console.error(contentGate.reason);
    process.exit(2);
  }

  const budgetGate = validateContextBudgetArtifacts(
    runId,
    completedPhase,
    manifest,
    enforcement,
  );
  if (!budgetGate.ok) {
    recordLog(manifest, {
      event: "gate_fail",
      phase: completedPhase,
      phase_kind: manifest.phase_kind,
      detail: budgetGate.reason,
      level: "warn",
    });
    manifest.updated_at = isoNow();
    writeJson(manifestPath, manifest);
    console.error(budgetGate.reason);
    process.exit(2);
  }
}

const now = isoNow();
const completedIsGate = isGatePhase(completedPhase, registry);

if (completedIsGate) {
  recordLog(manifest, {
    event: "gate_pass",
    phase: completedPhase,
    phase_kind: "gate",
    detail: "gate phase completed",
    level: "info",
  });
  manifest.gates = manifest.gates ?? { stack: null, results: {} };
  manifest.gates.results[completedPhase] = "pass";
}

if (completedPhase === "execute") {
  recordLog(manifest, {
    event: "execute_complete",
    phase: completedPhase,
    phase_kind: "work",
    detail: "execute phase completed",
    level: "info",
  });
}

manifest.completed.push(completedPhase);
const phaseCompletedAt = isoNow();
manifest.phase_metrics = manifest.phase_metrics ?? {};
const phaseDurationMs = computePhaseDurationMs(manifest, completedPhase, phaseCompletedAt);
if (phaseDurationMs != null) {
  manifest.phase_metrics[completedPhase] = {
    ...(manifest.phase_metrics[completedPhase] ?? {}),
    duration_ms: phaseDurationMs,
  };
}
recordPhaseContextTelemetry(manifest, completedPhase, runId, enforcement);
const phaseMetrics = manifest.phase_metrics?.[completedPhase] ?? {};
const contextEntry = manifest.context?.phases?.[completedPhase] ?? {};
const phaseCompleteDetail = formatPhaseMetricsDetail({
  ...(minAgents ? { swarm_count: launches, swarm_target: targetDetail.target } : {}),
  ...(manifest.complexity?.scope_score != null
    ? { scope_score: manifest.complexity.scope_score }
    : {}),
  ...(manifest.complexity?.change_score != null
    ? { change_score: manifest.complexity.change_score }
    : {}),
  ...(phaseMetrics.tokens != null ? { tokens: phaseMetrics.tokens } : {}),
  ...(phaseMetrics.context != null
    ? { score: phaseMetrics.context }
    : contextEntry.estimated_utilization != null
      ? { score: contextEntry.estimated_utilization }
      : {}),
  ...(contextEntry.artifact_bytes != null ? { artifact_bytes: contextEntry.artifact_bytes } : {}),
  ...(phaseMetrics.files_read != null ? { files_read: phaseMetrics.files_read } : {}),
  ...(phaseMetrics.edits != null ? { edits: phaseMetrics.edits } : {}),
  ...(phaseMetrics.duration_ms != null ? { duration_ms: phaseMetrics.duration_ms } : {}),
});
recordLog(manifest, {
  event: "phase_complete",
  phase: completedPhase,
  phase_kind: manifest.phase_kind,
  detail: phaseCompleteDetail,
  level: "info",
});

try {
  const stageSummary = writeStageSummary(runId, completedPhase, {
    manifest,
    enforcement,
  });
  recordLog(manifest, {
    event: "stage_summary_written",
    phase: completedPhase,
    phase_kind: manifest.phase_kind,
    detail: `status=${stageSummary.status}${
      stageSummary.reason ? ` reason=${stageSummary.reason}` : ""
    }`,
    level: stageSummary.status === "failed" ? "warn" : "info",
  });
} catch (err) {
  recordLog(manifest, {
    event: "stage_summary_failed",
    phase: completedPhase,
    phase_kind: manifest.phase_kind,
    detail: String(err?.message ?? err).slice(0, 300),
    level: "warn",
  });
}

let nextPhase = manifest.pending.shift() ?? null;

if (nextPhase === "execute" && !force) {
  const resolved =
    manifest.capabilities_resolved &&
    Object.keys(manifest.capabilities_resolved).length > 0
      ? manifest.capabilities_resolved
      : resolveCapabilitiesWithRuntime(manifest.object, manifest.verb);
  const policy = evaluateCapabilityRuntimePolicy(resolved, {
    object_maturity: loadObjectMaturity(manifest.object),
  });
  manifest.capability_runtime = policy;

  const needsBlock =
    policy.action === "block" ||
    (policy.action === "require_approval" && !manifest.capability_runtime_approved);

  if (needsBlock) {
    manifest.pending.unshift(nextPhase);
    nextPhase = null;
    manifest.status = "blocked";
    manifest.awaiting_approval = policy.action === "require_approval";
    manifest.blocked_reason = policy.reasons.join("; ") || "capability runtime policy";
    recordLog(manifest, {
      event: "gate_fail",
      phase: completedPhase,
      phase_kind: manifest.phase_kind,
      detail: `capability runtime ${policy.action}: ${manifest.blocked_reason}`,
      level: "warn",
    });
    manifest.updated_at = isoNow();
    writeJson(manifestPath, manifest);
    saveActiveRun(manifest.conversation_id ?? null, {
      run_id: runId,
      conversation_id: manifest.conversation_id ?? null,
      command: manifest.command,
      phase: manifest.phase,
      status: manifest.status,
      task_launches_this_phase: 0,
      edit_allowed: false,
      started_at: manifest.created_at,
    });
    console.error(
      `Capability runtime ${policy.action}: ${manifest.blocked_reason}. ` +
        (policy.action === "require_approval"
          ? "User must approve in chat; set capability_runtime_approved on Run and retry."
          : "Cannot proceed to execute."),
    );
    process.exit(2);
  }

  if (policy.action === "warn") {
    recordLog(manifest, {
      event: "capability_runtime_warn",
      phase: completedPhase,
      phase_kind: manifest.phase_kind,
      detail: policy.reasons.join("; "),
      level: "warn",
    });
  }
}

if (!nextPhase) {
  // Terminal phase must be archived like every prior phase — UI/history SSOT
  // reads swarm_history[phase].agents for completed phases only.
  archivePhaseSwarm(manifest, completedPhase);
  manifest.status = "completed";
  manifest.phase = "report";
  manifest.completed_at = isoNow();
  finalizeRunMetrics(manifest);
  manifest.enforcement.edit_allowed = false;
  recordLog(manifest, {
    event: "run_completed",
    phase: "report",
    phase_kind: "work",
    detail: "all phases completed",
    level: "info",
  });

  try {
    const evidenceResult = processRunEvidence(runId, { manifest, skipManifestWrite: true });
    if (evidenceResult.ok && !evidenceResult.skipped) {
      manifest.capability_evidence_processed = true;
      manifest.capability_evidence_outcomes = evidenceResult.outcomes;
      if (
        !manifest.capabilities_resolved ||
        !Object.keys(manifest.capabilities_resolved).length
      ) {
        manifest.capabilities_resolved = evidenceResult.resolved;
      }
      recordLog(manifest, {
        event: "evidence_aggregated",
        phase: "report",
        phase_kind: "work",
        detail: `capabilities=${(evidenceResult.capabilities ?? []).join(",")}`,
        level: "info",
      });
      for (const outcome of evidenceResult.outcomes ?? []) {
        if (outcome.previous_state !== outcome.new_state) {
          recordLog(manifest, {
            event: "capability_promoted",
            phase: "report",
            phase_kind: "work",
            detail: `${outcome.capability_id}:${outcome.previous_state}→${outcome.new_state}`,
            level: "info",
          });
        }
      }
    }
  } catch (err) {
    recordLog(manifest, {
      event: "evidence_aggregation_failed",
      phase: "report",
      phase_kind: "work",
      detail: String(err.message ?? err).slice(0, 300),
      level: "warn",
    });
  }

  try {
    const experienceResult = await processRunExperience(runId, {
      manifest,
      skipManifestWrite: true,
    });
    if (experienceResult.ok && !experienceResult.skipped) {
      manifest.outcome = {
        status: experienceResult.outcome.status,
        quality: experienceResult.outcome.quality,
        gate_retries: experienceResult.outcome.gate_retries,
        rollback_used: experienceResult.outcome.rollback_used,
        human_interventions: experienceResult.outcome.human_interventions,
      };
      manifest.reflection = {
        path: "artifacts/reflection.json",
        goal_achieved: experienceResult.reflection.goal_achieved,
        largest_bottleneck: experienceResult.reflection.largest_bottleneck,
        biggest_waste: experienceResult.reflection.biggest_waste,
        most_valuable_artifact: experienceResult.reflection.most_valuable_artifact,
        reusable_lesson: experienceResult.reflection.reusable_lesson,
        recommendation: experienceResult.reflection.recommendation,
        confidence: experienceResult.reflection.confidence,
      };
      manifest.lessons = experienceResult.lessons ?? [];
      manifest.experience_processed = true;
      manifest.experience_outcomes = experienceResult.experience_outcomes ?? [];
      manifest.artifacts = {
        ...(manifest.artifacts ?? {}),
        reflection: "artifacts/reflection.json",
      };
      recordLog(manifest, {
        event: "experience_processed",
        phase: "report",
        phase_kind: "work",
        detail: `lessons=${(experienceResult.lessons ?? []).length}`,
        level: "info",
      });
      recordLog(manifest, {
        event: "reflection_written",
        phase: "report",
        phase_kind: "work",
        detail: "artifacts/reflection.json",
        level: "info",
      });
      for (const lesson of experienceResult.lessons ?? []) {
        recordLog(manifest, {
          event: "lesson_upserted",
          phase: "report",
          phase_kind: "work",
          detail: `${lesson.id}:observed=${lesson.evidence?.observed_runs}:confidence=${lesson.evidence?.confidence}`,
          level: "info",
        });
      }
    }
  } catch (err) {
    recordLog(manifest, {
      event: "experience_aggregation_failed",
      phase: "report",
      phase_kind: "work",
      detail: String(err.message ?? err).slice(0, 300),
      level: "warn",
    });
  }
} else {
  archivePhaseSwarm(manifest, completedPhase);
  const priorAgents = manifest.swarm?.agents ?? [];
  manifest.phase = nextPhase;
  manifest.phase_kind = phaseKind(nextPhase, registry);
  manifest.swarm = {
    ...(manifest.swarm ?? {}),
    task_launches_this_phase: 0,
    phase: nextPhase,
    agents: priorAgents,
  };
  manifest.enforcement.edit_allowed = isEditPhase(nextPhase, enforcement);
  applyNextPhaseSwarmTarget(runId, manifest, nextPhase);
  try {
    await preparePhaseContext(runId, manifest);
  } catch {
    // soft-fail — do not block phase advance
  }

  recordLog(manifest, {
    event: "phase_start",
    phase: nextPhase,
    phase_kind: manifest.phase_kind,
    detail: "advanced",
    level: "info",
  });

  if (nextPhase === "execute") {
    recordLog(manifest, {
      event: "execute_start",
      phase: nextPhase,
      phase_kind: "work",
      detail: "edit phase unlocked",
      level: "info",
    });
  }

  if (isGatePhase(nextPhase, registry)) {
    recordLog(manifest, {
      event: "gate_blocked",
      phase: nextPhase,
      phase_kind: "gate",
      detail: "awaiting gate evaluation",
      level: "debug",
    });
  }
}

manifest.updated_at = now;
writeJson(manifestPath, manifest);

syncRunSidecars(manifest);

console.log(
  JSON.stringify({
    ok: true,
    run_id: runId,
    completed: completedPhase,
    phase: manifest.phase,
    status: manifest.status,
    edit_allowed: manifest.enforcement.edit_allowed,
  }),
);
