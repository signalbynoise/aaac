#!/usr/bin/env node
/**
 * Safety checks for remediation runner + babysit loop.
 *
 * Exit codes:
 *   0 — healthy
 *   1 — stall or regression detected (babysit should investigate)
 *   2 — missing state
 *
 * Usage:
 *   node runner-health-check.mjs --campaign-id <id> [--max-stall-ticks 20] [--max-yield-minutes 120]
 */
import fs from "fs";
import path from "path";
import {
  campaignDir,
  iterDir,
  loadCampaign,
  loadRunnerState,
  loadYield,
  runnerStatePath,
} from "./lib/runner-state.mjs";
import { readStartBaseline } from "./lib/fallow-metrics.mjs";

function parseArgs(argv) {
  const out = { campaignId: null, maxStallTicks: 20, maxYieldMinutes: 120 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--max-stall-ticks") out.maxStallTicks = Number(argv[++i]);
    else if (a === "--max-yield-minutes") out.maxYieldMinutes = Number(argv[++i]);
  }
  return out;
}

function minutesSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("runner-health-check: --campaign-id required");
  process.exit(2);
}

const campaign = loadCampaign(args.campaignId);
const state = loadRunnerState(args.campaignId);
if (!campaign || !state) {
  console.error("Missing campaign or runner-state.json");
  process.exit(2);
}

const issues = [];
const warnings = [];

if (state.stall_count >= args.maxStallTicks) {
  issues.push({
    code: "stall_ticks",
    message: `No score/clone progress for ${state.stall_count} ticks`,
  });
}

const yieldPayload = loadYield(args.campaignId);
if (state.status === "yielded" && yieldPayload) {
  const yieldAge = minutesSince(yieldPayload.at ?? state.updated_at);
  if (yieldAge > args.maxYieldMinutes) {
    issues.push({
      code: "yield_timeout",
      message: `Agent yield pending ${Math.round(yieldAge)}m (type=${yieldPayload.type})`,
      yield: yieldPayload,
    });
  }
}

const cDir = campaignDir(args.campaignId);
const dupesStart = readStartBaseline(cDir, "fallow-start-dupes-baseline.json", "clone_groups");
const healthStart = readStartBaseline(cDir, "fallow-start-health-baseline.json", "health_score");
const currentDupes = campaign.current?.fallow_dupes_clone_groups;
const currentHealth = campaign.current?.fallow_health_score;

if (
  dupesStart.value != null &&
  currentDupes != null &&
  currentDupes > dupesStart.value * 1.05
) {
  issues.push({
    code: "dupes_regression",
    message: `Clone groups ${currentDupes} > baseline ${dupesStart.value}`,
  });
}

if (
  healthStart.value != null &&
  currentHealth != null &&
  currentHealth < healthStart.value - 2
) {
  issues.push({
    code: "health_regression",
    message: `Health ${currentHealth} dropped >2 vs baseline ${healthStart.value}`,
  });
}

const threshold = campaign.config?.satisfaction_threshold ?? 85;
const score = campaign.current?.satisfaction_score;
const maxIter = campaign.config?.max_iterations ?? 5;
if (
  score != null &&
  score < threshold &&
  state.iteration >= maxIter - 1 &&
  state.phase !== "report"
) {
  warnings.push({
    code: "near_max_iterations",
    message: `Iteration ${state.iteration}/${maxIter - 1} with score ${score}/${threshold}`,
  });
}

if (state.status === "running" && !yieldPayload) {
  const sinceProgress = minutesSince(state.last_progress_at);
  if (sinceProgress > args.maxYieldMinutes && score != null && score < threshold) {
    warnings.push({
      code: "long_run_no_progress",
      message: `No metric progress in ${Math.round(sinceProgress)}m`,
    });
  }
}

const historyPath = path.join(cDir, "satisfaction-history.yaml");
if (fs.existsSync(historyPath)) {
  try {
    const raw = fs.readFileSync(historyPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.entries?.length >= 3) {
      const last3 = parsed.entries.slice(-3);
      const scores = last3.map((e) => e.score);
      if (scores[0] === scores[1] && scores[1] === scores[2]) {
        warnings.push({
          code: "flat_satisfaction",
          message: `Score flat at ${scores[2]} for 3 iterations`,
        });
      }
    }
  } catch {
    /* ignore parse errors */
  }
}

const healthy = issues.length === 0;
const payload = {
  ok: healthy,
  campaign_id: args.campaignId,
  runner_status: state.status,
  phase: state.phase,
  iteration: state.iteration,
  score,
  threshold,
  issues,
  warnings,
  runner_state_path: runnerStatePath(args.campaignId),
};

console.log(JSON.stringify(payload, null, 2));
process.exit(healthy ? 0 : 1);
