#!/usr/bin/env node
/** One-shot Run status. Usage: debug-run.mjs <run_id> [--json] */
import { loadRunManifest } from "./lib.mjs";
import { debugRunSummary } from "./log.mjs";

const runId = process.argv[2];
const asJson = process.argv.includes("--json");

if (!runId) {
  console.error("Usage: debug-run.mjs <run_id> [--json]");
  process.exit(1);
}

const manifest = loadRunManifest(runId);
if (!manifest) {
  console.error(`Run not found: ${runId}`);
  process.exit(1);
}

const summary = debugRunSummary(manifest);

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

console.log(`Run: ${summary.run_id}`);
console.log(`Command: /${summary.command}  verb=${summary.verb}  status=${summary.status}`);
console.log(`Phase: ${summary.phase} (${summary.phase_kind})  edit_allowed=${summary.edit_allowed}`);
if (summary.blocked_reason) console.log(`Blocked: ${summary.blocked_reason}`);
console.log(`Completed: ${summary.completed.join(" → ") || "(none)"}`);
console.log(`Pending: ${summary.pending.join(" → ") || "(none)"}`);
console.log(`Swarm: phase=${summary.swarm.phase} count=${summary.swarm.task_launches_this_phase}`);
if (summary.swarm.agents?.length) {
  console.log(`Agents: ${summary.swarm.agents.length} recorded this phase`);
  for (const a of summary.swarm.agents.slice(-5)) {
    console.log(`  #${a.index} ${a.subagent_type ?? "?"} ${a.description ?? ""} @ ${a.at}`);
  }
}
console.log(`Log: ${summary.log_count} entries  Decisions: ${summary.decisions_count}`);
console.log("--- last 10 log entries ---");
for (const e of summary.last_log_entries) {
  console.log(`${e.at} ${e.phase} :: ${e.event} — ${e.detail}`);
}
