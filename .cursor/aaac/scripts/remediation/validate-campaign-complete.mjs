#!/usr/bin/env node
/**
 * Hard invariants before remediate-app may advance to report / complete.
 *
 * Exit 0 — safe to report (or loop iteration with partial satisfaction)
 * Exit 1 — blocked with reasons (orchestrator must NOT complete run)
 *
 * Usage:
 *   node validate-campaign-complete.mjs --campaign-id <id> [--iteration <n>] \
 *     [--require-debt-sweep] [--require-satisfaction-loop]
 */
import fs from "fs";
import path from "path";
import { REPO_ROOT, readJson } from "../run-engine/lib.mjs";

const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

function parseArgs(argv) {
  const out = { campaignId: null, iteration: null, requireDebtSweep: false, requireSatisfactionLoop: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--require-debt-sweep") out.requireDebtSweep = true;
    else if (a === "--require-satisfaction-loop") out.requireSatisfactionLoop = true;
  }
  return out;
}

function iterDir(campaignId, n) {
  return path.join(CAMPAIGNS_ROOT, campaignId, "iterations", String(n));
}

function checkRemediatorLoops(iterationPath) {
  const violations = [];
  if (!fs.existsSync(iterationPath)) return violations;
  for (const name of fs.readdirSync(iterationPath)) {
    if (!name.startsWith("remediator-loop-") || !name.endsWith(".json")) continue;
    const state = readJson(path.join(iterationPath, name), {});
    if (state.status === "running") {
      violations.push(`remediator_loop_running:${name}`);
    }
  }
  return violations;
}

function checkPlannedWaves(campaignId, iteration, runArtifactsDir) {
  const violations = [];
  const planPath = runArtifactsDir
    ? path.join(runArtifactsDir, "plan_waves.yaml")
    : null;
  const executePath = runArtifactsDir
    ? path.join(runArtifactsDir, "execute_waves.yaml")
    : null;

  let plannedCount = null;
  if (planPath && fs.existsSync(planPath)) {
    const text = fs.readFileSync(planPath, "utf8");
    const matches = text.match(/^\s*-\s+priority:/gm);
    plannedCount = matches?.length ?? 0;
  }

  if (executePath && fs.existsSync(executePath)) {
    const executed = readJson(executePath.replace(/\.yaml$/, ".json"), null);
    if (executed?.waves) {
      const incomplete = executed.waves.filter(
        (w) => !["completed", "degraded", "deferred", "promoted"].includes(w.status),
      );
      if (incomplete.length) {
        violations.push(`waves_not_executed:${incomplete.map((w) => w.wave_index).join(",")}`);
      }
    }
  } else if (plannedCount != null && plannedCount > 0) {
    violations.push("execute_waves_artifact_missing");
  }

  const loopFiles = fs.existsSync(iterDir(campaignId, iteration))
    ? fs.readdirSync(iterDir(campaignId, iteration)).filter((n) => n.startsWith("remediator-loop-wave-"))
    : [];
  if (plannedCount != null && loopFiles.length < plannedCount) {
    violations.push(`wave_gates_incomplete:${loopFiles.length}/${plannedCount}`);
  }

  return violations;
}

function checkDebtSweep(campaign, iteration) {
  const violations = [];
  const sweep = campaign.debt_sweep;
  if (!sweep || sweep.status !== "complete") {
    violations.push("debt_sweep_incomplete");
  } else if (sweep.iteration != null && sweep.iteration < iteration) {
    violations.push("debt_sweep_stale_for_iteration");
  }

  const sweepState = readJson(path.join(iterDir(campaign.campaign_id, iteration), "debt-sweep-state.json"), null);
  if (sweepState?.status === "running") {
    violations.push("debt_sweep_running");
  }

  const verifyDebt = readJson(path.join(iterDir(campaign.campaign_id, iteration), "verify-debt.json"), null);
  if (verifyDebt && (verifyDebt.status !== "pass" || (verifyDebt.metrics?.total_errors ?? 0) > 0)) {
    violations.push(`verify_debt_errors:${verifyDebt.metrics?.total_errors ?? "unknown"}`);
  }

  return violations;
}

function checkSatisfactionLoop(campaign, iteration, runArtifactsDir) {
  const violations = [];
  const gatePath = runArtifactsDir
    ? path.join(runArtifactsDir, "satisfaction_loop_gate.json")
    : null;
  const gate = gatePath && fs.existsSync(gatePath) ? readJson(gatePath, null) : null;
  if (!gate) {
    violations.push("satisfaction_loop_gate_missing");
    return violations;
  }
  if (gate.action === "continue_loop" || gate.allow_report === false) {
    violations.push(`satisfaction_loop_blocks_report:${gate.action}`);
  }
  if (gate.orchestrator_must_not_report === true) {
    violations.push("satisfaction_loop_must_continue");
  }
  const threshold = campaign.config?.satisfaction_threshold ?? 85;
  const maxIter = campaign.config?.max_iterations ?? 5;
  const satisfied = gate.action === "complete" && gate.reason === "satisfaction_threshold_met";
  const partial = gate.action === "partial_complete" && gate.reason === "max_iterations_reached";
  if (!satisfied && !partial && iteration + 1 < maxIter) {
    const sat = readJson(path.join(iterDir(campaign.campaign_id, iteration), "satisfaction.json"), null);
    if (sat && sat.score < threshold) {
      violations.push(`satisfaction_below_threshold:${sat.score}<${threshold}`);
    }
  }
  return violations;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("validate-campaign-complete: --campaign-id required");
  process.exit(2);
}

const campaign = readJson(path.join(CAMPAIGNS_ROOT, args.campaignId, "campaign.json"), null);
if (!campaign) {
  console.error("validate-campaign-complete: campaign not found");
  process.exit(2);
}

const iteration = args.iteration ?? campaign.iteration ?? 0;
const iterationPath = iterDir(args.campaignId, iteration);
const runArtifactsDir = campaign.run_id
  ? path.join(REPO_ROOT, ".cursor/aaac/state/runs", campaign.run_id, "artifacts")
  : null;

const violations = [
  ...checkRemediatorLoops(iterationPath),
  ...checkPlannedWaves(args.campaignId, iteration, runArtifactsDir),
];

if (args.requireDebtSweep) {
  violations.push(...checkDebtSweep(campaign, iteration));
}

if (args.requireSatisfactionLoop) {
  violations.push(...checkSatisfactionLoop(campaign, iteration, runArtifactsDir));
}

if (campaign.status === "blocked" && args.requireDebtSweep) {
  violations.push("campaign_status_blocked");
}

const ok = violations.length === 0;
const result = {
  ok,
  campaign_id: args.campaignId,
  iteration,
  violations,
  invariants: {
    no_running_remediator_loops: !violations.some((v) => v.startsWith("remediator_loop_running")),
    all_waves_gated: !violations.some((v) => v.startsWith("wave_gates_incomplete") || v.startsWith("waves_not_executed")),
    debt_sweep_complete: args.requireDebtSweep ? !violations.some((v) => v.includes("debt_sweep")) : null,
    no_remaining_verify_errors: args.requireDebtSweep ? !violations.some((v) => v.startsWith("verify_debt")) : null,
    satisfaction_loop_allows_report: args.requireSatisfactionLoop
      ? !violations.some((v) => v.startsWith("satisfaction_loop"))
      : null,
  },
};

console.log(JSON.stringify(result));
process.exit(ok ? 0 : 1);
