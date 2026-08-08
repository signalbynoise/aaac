#!/usr/bin/env node
/**
 * Strict debt sweep — mandatory phase after cleanup waves.
 * Loops remediator-gate --mode debt until all layers pass or max rounds exhausted.
 *
 * Exit codes:
 *   0 — debt sweep complete (strict pass)
 *   1 — blocked (max rounds exhausted)
 *   3 — remediate required (agent must fix and re-run with --round N --attempt M+1)
 *
 * Usage:
 *   node debt-sweep-gate.mjs --campaign-id <id> --iteration <n> \
 *     [--run-id <run_id>] [--round <n>] [--attempt <n>]
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { REPO_ROOT, isoNow, readJson, writeJson, runDir } from "../run-engine/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");
const REMEDIATOR_GATE = path.join(__dirname, "remediator-gate.mjs");

function parseArgs(argv) {
  const out = { campaignId: null, iteration: 0, runId: null, round: 1, attempt: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--round") out.round = Number(argv[++i]);
    else if (a === "--attempt") out.attempt = Number(argv[++i]);
  }
  return out;
}

function campaignDir(id) {
  return path.join(CAMPAIGNS_ROOT, id);
}

function appendJournal(campaignId, text) {
  fs.appendFileSync(path.join(campaignDir(campaignId), "journal.md"), text);
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("debt-sweep-gate: --campaign-id required");
  process.exit(2);
}

const campaignPath = path.join(campaignDir(args.campaignId), "campaign.json");
const campaign = readJson(campaignPath, {});
const maxRounds = campaign?.config?.max_debt_sweep_rounds ?? 10;
const iterDir = path.join(campaignDir(args.campaignId), "iterations", String(args.iteration));
fs.mkdirSync(iterDir, { recursive: true });

const statePath = path.join(iterDir, "debt-sweep-state.json");
let sweepState = readJson(statePath, {
  status: "running",
  round: args.round,
  attempts_by_round: {},
  started_at: isoNow(),
});

const gateArgs = [
  REMEDIATOR_GATE,
  "--campaign-id",
  args.campaignId,
  "--iteration",
  String(args.iteration),
  "--mode",
  "debt",
  "--attempt",
  String(args.attempt),
];
if (args.runId) gateArgs.push("--run-id", args.runId);

const result = spawnSync(process.execPath, gateArgs, { encoding: "utf8" });
let payload = null;
try {
  payload = JSON.parse(result.stdout.trim().split("\n").pop());
} catch {
  console.error("debt-sweep-gate: failed to parse remediator-gate output");
  process.exit(2);
}

const roundKey = String(args.round);
sweepState.attempts_by_round[roundKey] = sweepState.attempts_by_round[roundKey] ?? [];
sweepState.attempts_by_round[roundKey].push({
  attempt: args.attempt,
  at: isoNow(),
  exit_code: result.status,
  action: payload.action,
});
sweepState.round = args.round;
sweepState.updated_at = isoNow();

if (result.status === 0 && (payload.action === "promote" || payload.action === "promote_wave")) {
  sweepState.status = "complete";
  sweepState.completed_at = isoNow();
  writeJson(statePath, sweepState);

  if (campaign) {
    campaign.debt_sweep = {
      status: "complete",
      iteration: args.iteration,
      round: args.round,
      completed_at: isoNow(),
    };
    campaign.updated_at = isoNow();
    writeJson(campaignPath, campaign);
  }

  appendJournal(args.campaignId, `- Debt sweep **COMPLETE** iter ${args.iteration} round ${args.round}\n`);

  const output = {
    action: "debt_sweep_complete",
    status: "pass",
    round: args.round,
    attempt: args.attempt,
    sweep_state_path: statePath,
    verify_path: payload.verify_path,
  };
  if (args.runId) {
    writeJson(path.join(runDir(args.runId), "artifacts", "debt_sweep.json"), output);
  }
  console.log(JSON.stringify(output));
  process.exit(0);
}

if (result.status === 3) {
  writeJson(statePath, sweepState);
  const output = {
    ...payload,
    debt_sweep_round: args.round,
    max_debt_sweep_rounds: maxRounds,
    campaign_must_continue: true,
    orchestrator_must_not_stop: true,
    retry_command: `node .cursor/aaac/scripts/remediation/debt-sweep-gate.mjs --campaign-id ${args.campaignId} --iteration ${args.iteration} --round ${args.round} --attempt ${args.attempt + 1}${args.runId ? ` --run-id ${args.runId}` : ""}`,
  };
  appendJournal(
    args.campaignId,
    `- Debt sweep round ${args.round} attempt ${args.attempt}: **remediate** — continue loop\n`,
  );
  if (args.runId) {
    writeJson(path.join(runDir(args.runId), "artifacts", "debt_sweep_handoff.json"), output);
  }
  console.log(JSON.stringify(output));
  process.exit(3);
}

if (result.status === 1) {
  if (args.round < maxRounds) {
    sweepState.status = "running";
    writeJson(statePath, sweepState);
    const nextRound = args.round + 1;
    const output = {
      action: "debt_sweep_next_round",
      status: "fail",
      round: args.round,
      next_round: nextRound,
      max_debt_sweep_rounds: maxRounds,
      campaign_must_continue: true,
      message: `Round ${args.round} blocked — starting round ${nextRound}`,
      retry_command: `node .cursor/aaac/scripts/remediation/debt-sweep-gate.mjs --campaign-id ${args.campaignId} --iteration ${args.iteration} --round ${nextRound} --attempt 1${args.runId ? ` --run-id ${args.runId}` : ""}`,
    };
    appendJournal(args.campaignId, `- Debt sweep round ${args.round} blocked — advancing to round ${nextRound}\n`);
    console.log(JSON.stringify(output));
    process.exit(3);
  }

  sweepState.status = "blocked";
  sweepState.blocked_at = isoNow();
  writeJson(statePath, sweepState);

  if (campaign) {
    campaign.debt_sweep = { status: "blocked", iteration: args.iteration, round: args.round };
    campaign.status = "blocked";
    campaign.updated_at = isoNow();
    writeJson(campaignPath, campaign);
  }

  const output = {
    action: "debt_sweep_blocked",
    status: "fail",
    reason: "max_debt_sweep_rounds_exhausted",
    round: args.round,
    max_debt_sweep_rounds: maxRounds,
    campaign_must_continue: false,
    payload,
  };
  appendJournal(args.campaignId, `- Debt sweep **BLOCKED** after ${maxRounds} rounds\n`);
  if (args.runId) {
    writeJson(path.join(runDir(args.runId), "artifacts", "debt_sweep.json"), output);
  }
  console.log(JSON.stringify(output));
  process.exit(1);
}

console.error("debt-sweep-gate: unexpected remediator exit", result.status);
process.exit(2);
