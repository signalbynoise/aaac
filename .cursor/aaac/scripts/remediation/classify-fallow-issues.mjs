#!/usr/bin/env node
/**
 * Classify Fallow scan findings and persist actionable vs false-positive SSOT.
 *
 * Usage:
 *   node classify-fallow-issues.mjs --campaign-id <id> --iteration <n> [--save-actionable-baseline]
 */
import fs from "fs";
import path from "path";
import { REPO_ROOT, isoNow, readJson, writeJson } from "../run-engine/lib.mjs";
import { classifyFallowScan, loadFpRules } from "./lib/fallow-classifier.mjs";

const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

function parseArgs(argv) {
  const out = { campaignId: null, iteration: 0, saveActionableBaseline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--save-actionable-baseline") out.saveActionableBaseline = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("classify-fallow-issues: --campaign-id required");
  process.exit(2);
}

const campaignDir = path.join(CAMPAIGNS_ROOT, args.campaignId);
const iterDir = path.join(campaignDir, "iterations", String(args.iteration));
const scanPath = path.join(iterDir, "fallow-scan.json");
const scan = readJson(scanPath, null);

if (!scan) {
  console.error(`classify-fallow-issues: missing ${scanPath}`);
  process.exit(2);
}

const classification = classifyFallowScan({
  scan,
  campaignDir,
  rules: loadFpRules(),
});

const outPath = path.join(iterDir, "fallow-classification.json");
writeJson(outPath, classification);

const actionableBaselinePath = path.join(campaignDir, "fallow-start-actionable-baseline.json");
if (args.saveActionableBaseline && !fs.existsSync(actionableBaselinePath)) {
  writeJson(actionableBaselinePath, {
    actionable_total: classification.summary.actionable_total,
    raw_total: classification.summary.raw_total,
    false_positive_total: classification.summary.false_positive_total,
    recorded_at: isoNow(),
    immutable: true,
    source: "classify-fallow-issues",
    iteration: args.iteration,
  });
}

const campaign = readJson(path.join(campaignDir, "campaign.json"), null);
if (campaign) {
  campaign.current = campaign.current ?? {};
  campaign.current.fallow_raw_total = classification.summary.raw_total;
  campaign.current.fallow_actionable_total = classification.summary.actionable_total;
  campaign.current.fallow_false_positive_total = classification.summary.false_positive_total;
  campaign.updated_at = isoNow();
  writeJson(path.join(campaignDir, "campaign.json"), campaign);
}

const journal = `\n- **Fallow classified** iter ${args.iteration}: raw=${classification.summary.raw_total}, actionable=${classification.summary.actionable_total}, false_positive=${classification.summary.false_positive_total}, review=${classification.summary.review_total}\n`;
fs.appendFileSync(path.join(campaignDir, "journal.md"), journal);

console.log(JSON.stringify({ ok: true, classification: classification.summary, path: outPath }));
