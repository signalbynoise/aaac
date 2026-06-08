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
  writeJson,
  saveActiveRun,
} from "./lib.mjs";
import { recordLog } from "./log.mjs";
import {
  processRunEvidence,
  evaluateCapabilityRuntimePolicy,
  resolveCapabilitiesWithRuntime,
  loadObjectMaturity,
} from "./capability-evidence.mjs";

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
  console.error(
    `Phase mismatch: current=${manifest.phase} completed=${completedPhase}`,
  );
  process.exit(1);
}

const minAgents = resolveSwarmMinimum(completedPhase, manifest, enforcement);
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

const requiredArtifacts = enforcement.phase_artifacts?.[completedPhase] ?? [];
for (const rel of requiredArtifacts) {
  const artifactPath = path.join(runDir(runId), rel);
  if (!fs.existsSync(artifactPath)) {
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
recordLog(manifest, {
  event: "phase_complete",
  phase: completedPhase,
  phase_kind: manifest.phase_kind,
  detail: minAgents ? `swarm_count=${launches}` : "ok",
  level: "info",
});

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
  manifest.status = "completed";
  manifest.phase = "report";
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
} else {
  manifest.phase = nextPhase;
  manifest.phase_kind = phaseKind(nextPhase, registry);
  manifest.swarm = { task_launches_this_phase: 0, phase: nextPhase };
  manifest.enforcement.edit_allowed = isEditPhase(nextPhase, enforcement);

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

saveActiveRun(manifest.conversation_id ?? null, {
  run_id: runId,
  conversation_id: manifest.conversation_id ?? null,
  command: manifest.command,
  phase: manifest.phase,
  status: manifest.status,
  task_launches_this_phase: 0,
  edit_allowed: manifest.enforcement.edit_allowed,
  started_at: manifest.created_at,
});

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
