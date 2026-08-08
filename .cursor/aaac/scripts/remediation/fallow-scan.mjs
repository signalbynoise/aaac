#!/usr/bin/env node
/**
 * Run full Fallow scan suite for remediation campaigns:
 *   dead-code, dupes, health (whole-repo JS/TS via frontend root).
 *
 * Usage:
 *   node fallow-scan.mjs --campaign-id <id> --iteration <n> [--save-baseline]
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { REPO_ROOT, isoNow, readJson, writeJson } from "../run-engine/lib.mjs";
import {
  FRONTEND_ROOT,
  runFallow,
  summarizeDeadCode,
  summarizeDupes,
  summarizeHealth,
} from "./lib/fallow-metrics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

const SCAN_TARGETS = [
  {
    id: "dead-code",
    subcommand: "dead-code",
    extraArgs: [],
    outFile: "fallow-scan.json",
    summarize: summarizeDeadCode,
    baselineFile: "fallow-start-baseline.json",
    baselineField: "fallow_total_issues",
    iterBaselineField: "fallow_total_issues",
  },
  {
    id: "dupes",
    subcommand: "dupes",
    extraArgs: [],
    outFile: "fallow-dupes.json",
    summarize: summarizeDupes,
    baselineFile: "fallow-start-dupes-baseline.json",
    baselineField: "clone_groups",
    iterBaselineField: "fallow_dupes_clone_groups",
  },
  {
    id: "health",
    subcommand: "health",
    extraArgs: ["--score", "--hotspots", "--top", "20"],
    outFile: "fallow-health.json",
    summarize: summarizeHealth,
    baselineFile: "fallow-start-health-baseline.json",
    baselineField: "health_score",
    iterBaselineField: "fallow_health_score",
  },
];

function parseArgs(argv) {
  const out = { campaignId: null, iteration: 0, saveBaseline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--save-baseline") out.saveBaseline = true;
  }
  return out;
}

function writeImmutableBaseline(campaignDir, target, summary, scanPath) {
  const baselinePath = path.join(campaignDir, target.baselineFile);
  const value = summary[target.baselineField] ?? summary.clone_groups ?? summary.health_score ?? null;
  const baseline = {
    [target.baselineField]: value,
    fallow_scan_path: scanPath,
    recorded_at: isoNow(),
    immutable: true,
    source: "fallow-scan",
    layer: target.id,
    summary,
  };
  writeJson(baselinePath, baseline);
  return baseline;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("fallow-scan: --campaign-id required");
  process.exit(2);
}

const campaignDir = path.join(CAMPAIGNS_ROOT, args.campaignId);
const iterDir = path.join(campaignDir, "iterations", String(args.iteration));
fs.mkdirSync(iterDir, { recursive: true });

const layers = {};
let anyRuntimeError = false;

for (const target of SCAN_TARGETS) {
  const outPath = path.join(iterDir, target.outFile);
  const run = runFallow(target.subcommand, target.extraArgs);
  const payload = run.payload ?? { error: true, message: "no payload" };
  const summary = target.summarize(payload);

  if (!run.ok) anyRuntimeError = true;

  const remediationMeta = {
    layer: target.id,
    scanned_at: isoNow(),
    root: FRONTEND_ROOT,
    exit_code: run.exit_code,
    summary,
    raw_path: outPath,
  };

  writeJson(outPath, { ...payload, _remediation: remediationMeta });
  layers[target.id] = { summary, exit_code: run.exit_code, path: outPath, ok: run.ok };
}

const bundlePath = path.join(iterDir, "fallow-scan-bundle.json");
const bundle = {
  scanned_at: isoNow(),
  root: FRONTEND_ROOT,
  scope_note:
    "Fallow v2 suite from frontend/ (dead-code + dupes + health). Backend Go and python/ verified via go test / pytest in verify gate.",
  layers: {
    dead_code: layers["dead-code"],
    dupes: layers.dupes,
    health: layers.health,
  },
};
writeJson(bundlePath, bundle);

const deadSummary = layers["dead-code"].summary;
const dupesSummary = layers.dupes.summary;
const healthSummary = layers.health.summary;

const campaign = readJson(path.join(campaignDir, "campaign.json"));
const startBaselinePath = path.join(campaignDir, "fallow-start-baseline.json");

if (campaign) {
  campaign.current = campaign.current ?? {};
  campaign.current.fallow_total_issues = deadSummary.total_issues;
  campaign.current.fallow_dupes_clone_groups = dupesSummary.clone_groups;
  campaign.current.fallow_health_score = healthSummary.health_score;
  campaign.updated_at = isoNow();

  const iterBaselinePath = path.join(iterDir, "iteration-baseline.json");
  if (args.saveBaseline) {
    writeJson(iterBaselinePath, {
      iteration: args.iteration,
      fallow_total_issues: deadSummary.total_issues,
      fallow_dupes_clone_groups: dupesSummary.clone_groups,
      fallow_dupes_duplication_percentage: dupesSummary.duplication_percentage,
      fallow_health_score: healthSummary.health_score,
      fallow_health_functions_above_threshold: healthSummary.functions_above_threshold,
      fallow_scan_path: path.join(iterDir, "fallow-scan.json"),
      fallow_dupes_path: path.join(iterDir, "fallow-dupes.json"),
      fallow_health_path: path.join(iterDir, "fallow-health.json"),
      recorded_at: isoNow(),
    });
  }

  if (args.saveBaseline && !fs.existsSync(startBaselinePath)) {
    const baseline = writeImmutableBaseline(
      campaignDir,
      SCAN_TARGETS[0],
      deadSummary,
      path.join(iterDir, "fallow-scan.json"),
    );
    campaign.baseline = { ...campaign.baseline, ...baseline };
    fs.appendFileSync(
      path.join(campaignDir, "journal.md"),
      `\n- **Fallow start baseline captured** (immutable) — dead-code total=${deadSummary.total_issues}\n`,
    );
  } else if (fs.existsSync(startBaselinePath)) {
    campaign.baseline = { ...campaign.baseline, ...readJson(startBaselinePath, {}) };
  }

  for (const target of SCAN_TARGETS.slice(1)) {
    const baselinePath = path.join(campaignDir, target.baselineFile);
    if (!fs.existsSync(baselinePath)) {
      const summary = layers[target.id].summary;
      const baseline = writeImmutableBaseline(
        campaignDir,
        target,
        summary,
        path.join(iterDir, target.outFile),
      );
      campaign.baseline = { ...campaign.baseline, ...baseline };
      fs.appendFileSync(
        path.join(campaignDir, "journal.md"),
        `- **Fallow ${target.id} baseline backfilled** — ${target.baselineField}=${baseline[target.baselineField]}\n`,
      );
    }
  }

  writeJson(path.join(campaignDir, "campaign.json"), campaign);
}

const classifyArgs = [
  path.join(__dirname, "classify-fallow-issues.mjs"),
  "--campaign-id",
  args.campaignId,
  "--iteration",
  String(args.iteration),
];
if (args.saveBaseline) classifyArgs.push("--save-actionable-baseline");
spawnSync(process.execPath, classifyArgs, { encoding: "utf8" });

console.log(
  JSON.stringify({
    ok: !anyRuntimeError,
    summary: deadSummary,
    dupes: dupesSummary,
    health: healthSummary,
    path: path.join(iterDir, "fallow-scan.json"),
    bundle_path: bundlePath,
  }),
);
