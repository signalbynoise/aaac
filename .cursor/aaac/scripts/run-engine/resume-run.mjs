#!/usr/bin/env node
/**
 * Resume a failed or orphaned AAAC run from manifest.phase.
 * Usage: node resume-run.mjs <run_id> [--json]
 */
import path from "path";
import {
  loadRunManifest,
  runDir,
  isoNow,
  writeJson,
  saveActiveRun,
} from "./lib.mjs";
import { recordLog, recordDecision } from "./log.mjs";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const runId = args.find((a) => !a.startsWith("-"));

if (!runId) {
  console.error("Usage: resume-run.mjs <run_id> [--json]");
  process.exit(1);
}

const manifestPath = path.join(runDir(runId), "run.json");
const manifest = loadRunManifest(runId);

if (!manifest) {
  console.error(`Run not found: ${runId}`);
  process.exit(1);
}

if (manifest.status === "completed") {
  console.error(`Run ${runId} is already completed`);
  process.exit(1);
}

if (manifest.status === "cancelled") {
  console.error(`Run ${runId} was cancelled — dispatch a new run instead`);
  process.exit(1);
}

if (manifest.awaiting_approval) {
  console.error(
    `Run ${runId} is awaiting approval — use approve-run.mjs --approve instead`,
  );
  process.exit(1);
}

const previousStatus = manifest.status;

function resetCurrentPhaseSwarm(manifest) {
  const phase = manifest.phase;
  if (!phase) return;

  const swarm = manifest.swarm ?? { task_launches_this_phase: 0, phase, agents: [] };
  const agents = (swarm.agents ?? []).filter((agent) => agent.phase !== phase);
  manifest.swarm = {
    ...swarm,
    phase,
    task_launches_this_phase: 0,
    agents,
  };
}

if (manifest.status === "failed" || manifest.status === "blocked") {
  manifest.status = "running";
  manifest.blocked_reason = null;
  resetCurrentPhaseSwarm(manifest);
}

recordLog(manifest, {
  event: "resumed",
  phase: manifest.phase,
  phase_kind: manifest.phase_kind,
  detail: `resumed from ${previousStatus} at phase ${manifest.phase}`,
  level: "info",
});

recordDecision(manifest, {
  phase: manifest.phase ?? "resume",
  decision: "run_resumed",
  reason: `Resumed from ${previousStatus}`,
  evidence: manifest.phase ?? "",
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
  edit_allowed: manifest.enforcement?.edit_allowed ?? false,
  started_at: manifest.created_at,
});

const result = {
  ok: true,
  run_id: runId,
  status: manifest.status,
  phase: manifest.phase,
  previous_status: previousStatus,
};

console.log(jsonOut ? JSON.stringify(result) : JSON.stringify(result, null, 2));
