#!/usr/bin/env node
/**
 * Capture campaign verify baseline at start (before any waves).
 *
 * Usage:
 *   node capture-verify-baseline.mjs --campaign-id <id> [--run-id <run_id>]
 */
import fs from "fs";
import path from "path";
import { REPO_ROOT, isoNow, readJson, writeJson, runDir } from "../run-engine/lib.mjs";
import {
  runVerifySteps,
  writeVerifyLogs,
  summarizeMetrics,
} from "./lib/verify-metrics.mjs";

const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

function parseArgs(argv) {
  const out = { campaignId: null, runId: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--campaign-id") out.campaignId = argv[++i];
    else if (argv[i] === "--run-id") out.runId = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("capture-verify-baseline: --campaign-id required");
  process.exit(2);
}

const campaignDir = path.join(CAMPAIGNS_ROOT, args.campaignId);
const baselineDir = path.join(campaignDir, "baseline");
fs.mkdirSync(baselineDir, { recursive: true });

const report = await runVerifySteps("wave");
writeVerifyLogs(report, baselineDir, "baseline");

const snapshot = {
  captured_at: isoNow(),
  kind: "campaign_verify_baseline",
  summary: summarizeMetrics(report),
  metrics: report.metrics,
  report_path: path.join(baselineDir, "verify-baseline.json"),
};

writeJson(snapshot.report_path, report);
writeJson(path.join(campaignDir, "verify-baseline.json"), snapshot);

const campaign = readJson(path.join(campaignDir, "campaign.json"), {});
if (campaign) {
  campaign.verify_baseline = snapshot.summary;
  campaign.updated_at = isoNow();
  writeJson(path.join(campaignDir, "campaign.json"), campaign);
}

if (args.runId) {
  writeJson(path.join(runDir(args.runId), "artifacts", "verify_baseline.json"), snapshot);
}

const journal = `\n- **Verify baseline captured** — total_errors=${snapshot.summary.total_errors} (typecheck ${snapshot.summary.layers.typecheck.error_count}, vitest ${snapshot.summary.layers.vitest.error_count})\n`;
fs.appendFileSync(path.join(campaignDir, "journal.md"), journal);

console.log(JSON.stringify({ ok: true, baseline: snapshot }));
