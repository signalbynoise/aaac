#!/usr/bin/env node
/**
 * List AAAC runs under state/runs/.
 * Usage: node list-runs.mjs [--status running|blocked|completed|failed|cancelled] [--json]
 */
import fs from "fs";
import path from "path";
import { RUNS_ROOT, loadRunManifest } from "./lib.mjs";
import { reconcileAllStaleRuns } from "./reconcile-run-status.mjs";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const statusIdx = args.indexOf("--status");
const statusFilter = statusIdx >= 0 ? args[statusIdx + 1] : null;

function listRuns() {
  reconcileAllStaleRuns();
  if (!fs.existsSync(RUNS_ROOT)) return [];

  const entries = fs.readdirSync(RUNS_ROOT, { withFileTypes: true });
  const runs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = loadRunManifest(entry.name);
    if (!manifest) continue;
    if (statusFilter && manifest.status !== statusFilter) continue;

    runs.push({
      run_id: manifest.run_id,
      command: manifest.command,
      domain: manifest.domain,
      intent: manifest.intent,
      status: manifest.status,
      phase: manifest.phase,
      phase_kind: manifest.phase_kind,
      origin: manifest.origin ?? "cursor-chat",
      session_id: manifest.session_id ?? null,
      awaiting_approval: manifest.awaiting_approval ?? false,
      blocked_reason: manifest.blocked_reason ?? null,
      confidence: manifest.confidence ?? {},
      created_at: manifest.created_at,
      updated_at: manifest.updated_at,
    });
  }

  runs.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  return runs;
}

const runs = listRuns();
if (jsonOut) {
  console.log(JSON.stringify({ ok: true, runs }, null, 2));
} else {
  for (const run of runs) {
    console.log(`${run.run_id}\t${run.status}\t${run.phase ?? "-"}\t/${run.command}`);
  }
}
