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
