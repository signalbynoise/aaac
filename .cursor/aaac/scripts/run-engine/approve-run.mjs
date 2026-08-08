#!/usr/bin/env node
/**
 * Approve or reject a blocked Run gate.
 * Usage: node approve-run.mjs <run_id> --approve [--reason "..."] [--json]
 *        node approve-run.mjs <run_id> --reject [--reason "..."] [--json]
 */
import path from "path";
import {
  loadRunManifest,
  runDir,
  isoNow,
  writeJson,
} from "./lib.mjs";
import { recordLog, recordDecision } from "./log.mjs";
import { processRunExperience } from "./experience/process.mjs";
import { finalizeRunMetrics } from "./swarm-telemetry.mjs";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const approve = args.includes("--approve");
const reject = args.includes("--reject");
const reasonIdx = args.indexOf("--reason");
const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : null;
const runId = args.find((a) => !a.startsWith("-"));

if (!runId || (!approve && !reject)) {
  console.error("Usage: approve-run.mjs <run_id> --approve|--reject [--reason text] [--json]");
  process.exit(1);
}

const manifestPath = path.join(runDir(runId), "run.json");
const manifest = loadRunManifest(runId);

if (!manifest) {
  console.error(`Run not found: ${runId}`);
  process.exit(1);
}

if (!manifest.awaiting_approval && manifest.status !== "blocked") {
  console.error(`Run ${runId} is not awaiting approval (status=${manifest.status})`);
  process.exit(1);
}

if (reject) {
  manifest.status = "failed";
  manifest.awaiting_approval = false;
  manifest.blocked_reason = reason ?? "User rejected gate";
  recordLog(manifest, {
    event: "blocked",
    phase: manifest.phase,
    phase_kind: manifest.phase_kind,
    detail: manifest.blocked_reason,
    level: "warn",
  });
  recordDecision(manifest, {
    phase: manifest.phase ?? "gate",
    decision: "user_rejected",
    reason: manifest.blocked_reason,
    evidence: reason ?? "",
  });
} else {
  manifest.status = "running";
  manifest.awaiting_approval = false;
  manifest.blocked_reason = null;
  // Capability runtime gates re-block unless this is set (see advance-phase.mjs).
  manifest.capability_runtime_approved = true;
  recordLog(manifest, {
    event: "resumed",
    phase: manifest.phase,
    phase_kind: manifest.phase_kind,
    detail: reason ?? "User approved gate",
    level: "info",
  });
  recordDecision(manifest, {
    phase: manifest.phase ?? "gate",
    decision: "user_approved",
    reason: reason ?? "User approved gate",
    evidence: reason ?? "",
  });
}

if (reject) {
  finalizeRunMetrics(manifest);
  try {
    const experienceResult = await processRunExperience(runId, {
      manifest,
      skipManifestWrite: true,
      force: true,
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
        phase: manifest.phase ?? "gate",
        phase_kind: manifest.phase_kind ?? "gate",
        detail: `lessons=${(experienceResult.lessons ?? []).length}`,
        level: "info",
      });
    }
  } catch (err) {
    recordLog(manifest, {
      event: "experience_aggregation_failed",
      phase: manifest.phase ?? "gate",
      phase_kind: manifest.phase_kind ?? "gate",
      detail: String(err.message ?? err).slice(0, 300),
      level: "warn",
    });
  }
}

manifest.updated_at = isoNow();
writeJson(manifestPath, manifest);

const result = {
  ok: true,
  run_id: runId,
  status: manifest.status,
  awaiting_approval: manifest.awaiting_approval,
  action: approve ? "approved" : "rejected",
};

console.log(jsonOut ? JSON.stringify(result) : JSON.stringify(result, null, 2));
