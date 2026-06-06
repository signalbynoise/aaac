#!/usr/bin/env node
/**
 * Advance Run to next phase. Validates swarm counts + required artifacts.
 * Usage: node advance-phase.mjs <run_id> <completed_phase> [--force]
 */
import fs from "fs";
import path from "path";
import {
  loadRegistry,
  loadEnforcement,
  loadRunManifest,
  runDir,
  isoNow,
  phaseKind,
  isEditPhase,
  isGatePhase,
  writeJson,
  saveActiveRun,
} from "./lib.mjs";
import { recordLog } from "./log.mjs";

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

const minAgents =
  completedPhase === "verify" &&
  (enforcement.fix_commands?.includes(manifest.command) || manifest.verb === "fix")
    ? enforcement.swarm_min_agents?.verify_fix
    : enforcement.swarm_min_agents?.[completedPhase];
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

const nextPhase = manifest.pending.shift() ?? null;
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
