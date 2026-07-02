#!/usr/bin/env node
/**
 * Enforced satisfaction loop decision — blocks premature report / run completion.
 *
 * Exit codes:
 *   0 — allow report (threshold met OR max_iterations exhausted)
 *   1 — prerequisites missing (debt sweep incomplete, verify fail)
 *   3 — continue loop (increment iteration → scan); orchestrator MUST NOT report
 *
 * Usage:
 *   node satisfaction-loop-gate.mjs --campaign-id <id> --iteration <n> \
 *     [--run-id <run_id>] [--advance] [--recompute]
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { readStartBaseline } from "./lib/fallow-metrics.mjs";
import { resolveActionableBaseline } from "./lib/fallow-classifier.mjs";
import { REPO_ROOT, isoNow, readJson, writeJson, runDir } from "../run-engine/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");
const COMPUTE_SCRIPT = path.join(__dirname, "compute-satisfaction.mjs");

function parseArgs(argv) {
  const out = {
    campaignId: null,
    iteration: 0,
    runId: null,
    advance: false,
    recompute: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--advance") out.advance = true;
    else if (a === "--recompute") out.recompute = true;
  }
  return out;
}

function campaignDir(id) {
  return path.join(CAMPAIGNS_ROOT, id);
}

function appendJournal(campaignId, text) {
  fs.appendFileSync(path.join(campaignDir(campaignId), "journal.md"), text);
}

function runCompute(campaignId, iteration) {
  const result = spawnSync(
    process.execPath,
    [COMPUTE_SCRIPT, "--campaign-id", campaignId, "--iteration", String(iteration)],
    { encoding: "utf8" },
  );
  try {
    return JSON.parse(result.stdout.trim().split("\n").pop());
  } catch {
    return { ok: false, error: "compute-satisfaction parse failed", stderr: result.stderr };
  }
}

function verifyStrictPass(iterDir) {
  const verify =
    readJson(path.join(iterDir, "verify-debt.json"), null) ??
    readJson(path.join(iterDir, "verify-iteration.json"), null);
  if (!verify) return { pass: false, reason: "missing_verify_debt" };
  const totalErrors = verify.metrics?.total_errors ?? 0;
  const pass =
    verify.status === "pass" &&
    totalErrors === 0 &&
    verify.typecheck?.status === "pass" &&
    verify.vitest?.status === "pass" &&
    (verify.go_test?.status === "pass" || verify.go_test?.status === "skipped") &&
    verify.build?.status === "pass" &&
    verify.playwright?.status === "pass";
  return { pass, verify, totalErrors };
}

function fallowRegression(campaign, satisfaction) {
  const cDir = campaignDir(campaign.campaign_id);
  const regressions = [];

  const actionableBaseline = resolveActionableBaseline(cDir);
  const startActionable =
    actionableBaseline?.actionable_total ??
    readJson(path.join(cDir, "fallow-start-baseline.json"), null)?.fallow_total_issues ??
    campaign.baseline?.fallow_total_issues ??
    null;
  const currentActionable =
    satisfaction.fallow_actionable_total ??
    satisfaction.fallow_total_issues ??
    satisfaction.fallow_raw_total ??
    0;

  if (startActionable != null && currentActionable > startActionable * 1.05) {
    regressions.push("dead_code");
  }

  const dupesStart = readStartBaseline(cDir, "fallow-start-dupes-baseline.json", "clone_groups");
  const currentDupes = satisfaction.fallow_dupes_clone_groups;
  if (
    dupesStart.value != null &&
    currentDupes != null &&
    currentDupes > dupesStart.value * 1.05
  ) {
    regressions.push("dupes");
  }

  const healthStart = readStartBaseline(cDir, "fallow-start-health-baseline.json", "health_score");
  const currentHealth = satisfaction.fallow_health_score;
  if (
    healthStart.value != null &&
    currentHealth != null &&
    currentHealth < healthStart.value - 2
  ) {
    regressions.push("health");
  }

  return regressions;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("satisfaction-loop-gate: --campaign-id required");
  process.exit(2);
}

const cDir = campaignDir(args.campaignId);
const campaignPath = path.join(cDir, "campaign.json");
const campaign = readJson(campaignPath, null);
if (!campaign) {
  console.error("satisfaction-loop-gate: campaign not found");
  process.exit(2);
}

const iteration = args.iteration ?? campaign.iteration ?? 0;
const iterDir = path.join(cDir, "iterations", String(iteration));
const satisfactionPath = path.join(iterDir, "satisfaction.json");

if (args.recompute || !fs.existsSync(satisfactionPath)) {
  runCompute(args.campaignId, iteration);
}

const satisfaction = readJson(satisfactionPath, null);
if (!satisfaction) {
  console.error("satisfaction-loop-gate: satisfaction.json missing");
  process.exit(2);
}

const threshold = campaign.config?.satisfaction_threshold ?? 85;
const maxIterations = campaign.config?.max_iterations ?? 5;
const debtSweep = campaign.debt_sweep ?? {};
const verifyCheck = verifyStrictPass(iterDir);

const violations = [];
if (debtSweep.status !== "complete" || debtSweep.iteration !== iteration) {
  violations.push("debt_sweep_incomplete");
}
if (!verifyCheck.pass) {
  violations.push(`verify_not_strict_pass:${verifyCheck.reason ?? verifyCheck.totalErrors}`);
}

if (violations.length) {
  const output = {
    action: "block",
    status: "fail",
    violations,
    iteration,
    satisfaction,
    campaign_must_continue: true,
    message: "Debt sweep or strict verify must pass before satisfaction loop decision",
  };
  if (args.runId) {
    writeJson(path.join(runDir(args.runId), "artifacts", "satisfaction_loop_gate.json"), output);
  }
  console.log(JSON.stringify(output));
  process.exit(1);
}

const score = satisfaction.score ?? 0;
const e2ePass = satisfaction.e2e_pass === true;
const vitestPass = satisfaction.vitest_pass === true;
const typecheckPass = satisfaction.typecheck_pass === true;
const buildPass = satisfaction.build_pass === true;
const regressions = fallowRegression(campaign, satisfaction);
const regressed = regressions.length > 0;

const allVerifyPass = e2ePass && vitestPass && typecheckPass && buildPass;
const thresholdMet = score >= threshold && allVerifyPass && !regressed;
const maxIterationsReached = iteration + 1 >= maxIterations;

if (thresholdMet) {
  campaign.status = "satisfied";
  campaign.updated_at = isoNow();
  writeJson(campaignPath, campaign);

  const output = {
    action: "complete",
    status: "pass",
    reason: "satisfaction_threshold_met",
    iteration,
    score,
    threshold,
    allow_report: true,
    campaign_must_continue: false,
    fallow_regressions: regressions,
  };
  appendJournal(
    args.campaignId,
    `- Satisfaction loop **COMPLETE** iter ${iteration} — score ${score} >= ${threshold}\n`,
  );
  if (args.runId) {
    writeJson(path.join(runDir(args.runId), "artifacts", "satisfaction_loop_gate.json"), output);
  }
  console.log(JSON.stringify(output));
  process.exit(0);
}

if (maxIterationsReached) {
  campaign.status = "running";
  campaign.updated_at = isoNow();
  writeJson(campaignPath, campaign);

  const output = {
    action: "partial_complete",
    status: "pass",
    reason: "max_iterations_reached",
    iteration,
    score,
    threshold,
    allow_report: true,
    campaign_must_continue: false,
    message: `Max iterations (${maxIterations}) reached with score ${score}/${threshold}`,
  };
  appendJournal(
    args.campaignId,
    `- Satisfaction loop **PARTIAL** — max_iterations=${maxIterations}, score ${score}/${threshold}\n`,
  );
  if (args.runId) {
    writeJson(path.join(runDir(args.runId), "artifacts", "satisfaction_loop_gate.json"), output);
  }
  console.log(JSON.stringify(output));
  process.exit(0);
}

const nextIteration = iteration + 1;
if (args.advance) {
  campaign.iteration = nextIteration;
  campaign.debt_sweep = { status: "pending", iteration: null };
  campaign.status = "running";
  campaign.updated_at = isoNow();
  writeJson(campaignPath, campaign);
  appendJournal(
    args.campaignId,
    `- Satisfaction loop **CONTINUE** — iter ${iteration} score ${score}/${threshold} → iteration ${nextIteration}\n`,
  );
}

const output = {
  action: "continue_loop",
  status: "fail",
  reason: "below_satisfaction_threshold",
  iteration,
  next_iteration: nextIteration,
  score,
  threshold,
  max_iterations: maxIterations,
  allow_report: false,
  campaign_must_continue: true,
  orchestrator_must_not_stop: true,
  orchestrator_must_not_report: true,
  retry_command: `node .cursor/aaac/scripts/remediation/satisfaction-loop-gate.mjs --campaign-id ${args.campaignId} --iteration ${nextIteration}${args.runId ? ` --run-id ${args.runId}` : ""} --advance --recompute`,
  next_phase: "scan",
  message: `Score ${score} < ${threshold} with ${maxIterations - nextIteration} iteration(s) remaining — return to scan`,
};

if (args.runId) {
  writeJson(path.join(runDir(args.runId), "artifacts", "satisfaction_loop_gate.json"), output);
}

console.log(JSON.stringify(output));
process.exit(3);
