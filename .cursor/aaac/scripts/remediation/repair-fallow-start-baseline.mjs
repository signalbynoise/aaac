#!/usr/bin/env node
/**
 * One-time repair for campaigns whose Fallow start baselines were overwritten or missing layers.
 *
 * Usage:
 *   node repair-fallow-start-baseline.mjs --campaign-id <id> --total <n> [--recorded-at <iso>]
 *   node repair-fallow-start-baseline.mjs --campaign-id <id> --dupes-clone-groups <n>
 *   node repair-fallow-start-baseline.mjs --campaign-id <id> --health-score <n>
 */
import fs from "fs";
import path from "path";
import { REPO_ROOT, isoNow, readJson, writeJson } from "../run-engine/lib.mjs";

const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

function parseArgs(argv) {
  const out = {
    campaignId: null,
    total: null,
    dupesCloneGroups: null,
    healthScore: null,
    recordedAt: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--total") out.total = Number(argv[++i]);
    else if (a === "--dupes-clone-groups") out.dupesCloneGroups = Number(argv[++i]);
    else if (a === "--health-score") out.healthScore = Number(argv[++i]);
    else if (a === "--recorded-at") out.recordedAt = argv[++i];
  }
  return out;
}

function repairLayer(cDir, filename, field, value, layer) {
  const startPath = path.join(cDir, filename);
  const existing = readJson(startPath, null);
  if (existing?.immutable && existing[field] != null) {
    return { skipped: true, reason: `${filename} already immutable`, baseline: existing };
  }
  const baseline = {
    [field]: value,
    fallow_scan_path: existing?.fallow_scan_path ?? null,
    recorded_at: args.recordedAt ?? existing?.recorded_at ?? isoNow(),
    immutable: true,
    source: "repair-fallow-start-baseline",
    layer,
    repaired_at: isoNow(),
  };
  writeJson(startPath, baseline);
  return { skipped: false, baseline };
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error(
    "repair-fallow-start-baseline: --campaign-id required; pass at least one of --total, --dupes-clone-groups, --health-score",
  );
  process.exit(2);
}

if (
  args.total == null &&
  args.dupesCloneGroups == null &&
  args.healthScore == null
) {
  console.error("repair-fallow-start-baseline: at least one metric required");
  process.exit(2);
}

const cDir = path.join(CAMPAIGNS_ROOT, args.campaignId);
const results = {};

if (args.total != null && !Number.isNaN(args.total)) {
  results.dead_code = repairLayer(
    cDir,
    "fallow-start-baseline.json",
    "fallow_total_issues",
    args.total,
    "dead-code",
  );
}

if (args.dupesCloneGroups != null && !Number.isNaN(args.dupesCloneGroups)) {
  results.dupes = repairLayer(
    cDir,
    "fallow-start-dupes-baseline.json",
    "clone_groups",
    args.dupesCloneGroups,
    "dupes",
  );
}

if (args.healthScore != null && !Number.isNaN(args.healthScore)) {
  results.health = repairLayer(
    cDir,
    "fallow-start-health-baseline.json",
    "health_score",
    args.healthScore,
    "health",
  );
}

const campaignPath = path.join(cDir, "campaign.json");
const campaign = readJson(campaignPath, null);
if (campaign) {
  campaign.baseline = { ...campaign.baseline };
  for (const r of Object.values(results)) {
    if (!r.skipped) Object.assign(campaign.baseline, r.baseline);
  }
  campaign.updated_at = isoNow();
  writeJson(campaignPath, campaign);
}

const journal = `\n- **Fallow baselines repaired** — ${JSON.stringify(results)}\n`;
fs.appendFileSync(path.join(cDir, "journal.md"), journal);

console.log(JSON.stringify({ ok: true, results }));
