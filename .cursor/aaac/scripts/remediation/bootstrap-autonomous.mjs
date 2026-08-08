#!/usr/bin/env node
/**
 * Write run + campaign artifacts when autonomous mode is active.
 * Called from init-campaign.mjs — orchestrator MUST follow bootstrap.next_action.
 *
 * Usage:
 *   node bootstrap-autonomous.mjs --run-id <id> --campaign-id <id>
 */
import fs from "fs";
import path from "path";
import { REPO_ROOT, isoNow, readJson, runDir, writeJson } from "../run-engine/lib.mjs";
import {
  autonomousBootstrapCommands,
  BABYSIT_SKILL,
} from "./lib/autonomous-mode.mjs";
import { loadRunnerState, loadYield, runnerStatePath, yieldArtifactPath } from "./lib/runner-state.mjs";

function parseArgs(argv) {
  const out = { runId: null, campaignId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--campaign-id") out.campaignId = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.runId || !args.campaignId) {
  console.error("bootstrap-autonomous: --run-id and --campaign-id required");
  process.exit(2);
}

const campaignPath = path.join(
  REPO_ROOT,
  ".cursor/aaac/state/campaigns",
  args.campaignId,
  "campaign.json",
);
const campaign = readJson(campaignPath, null);
if (!campaign?.config?.autonomous) {
  console.log(JSON.stringify({ ok: true, autonomous: false, skipped: true }));
  process.exit(0);
}

const commands = autonomousBootstrapCommands(args.runId, args.campaignId);
const runnerState = loadRunnerState(args.campaignId);
const yieldPayload = loadYield(args.campaignId);

const bootstrap = {
  ok: true,
  autonomous: true,
  autonomous_reason: campaign.config.autonomous_reason,
  campaign_id: args.campaignId,
  run_id: args.runId,
  iteration: campaign.iteration,
  satisfaction_threshold: campaign.config.satisfaction_threshold,
  orchestrator_mode: "shell_runner_yield_watcher",
  skill_required: BABYSIT_SKILL,
  orchestrator_must_not: [
    "walk_phases_manually_in_chat",
    "end_turn_before_runner_exit_0",
    "report_when_satisfaction_below_threshold",
  ],
  loop: [
    "read_babysit_skill",
    "runner_health_check",
    "remediation_yield_watcher",
    "if_exit_3_handle_yield_then_ack_yield",
    "repeat_until_exit_0",
  ],
  commands,
  runner_state_path: runnerStatePath(args.campaignId),
  yield_path: yieldArtifactPath(args.campaignId),
  current_runner: runnerState,
  pending_yield: yieldPayload,
  next_action: yieldPayload
    ? {
        type: "handle_yield",
        yield_type: yieldPayload.type,
        ack_command: `node .cursor/aaac/scripts/remediation/remediation-runner.mjs --run-id ${args.runId} --campaign-id ${args.campaignId} --ack-yield ${yieldPayload.type}`,
      }
    : {
        type: "run_until_yield",
        command: commands.runner_until_yield,
      },
  at: isoNow(),
};

const runArtifact = path.join(runDir(args.runId), "artifacts", "autonomous_bootstrap.json");
writeJson(runArtifact, bootstrap);

const campaignArtifact = path.join(
  REPO_ROOT,
  ".cursor/aaac/state/campaigns",
  args.campaignId,
  "autonomous-bootstrap.json",
);
writeJson(campaignArtifact, bootstrap);

appendJournal(args.campaignId, `- **Autonomous mode** — ${campaign.config.autonomous_reason}; bootstrap written`);

console.log(JSON.stringify(bootstrap));

function appendJournal(campaignId, line) {
  const journalPath = path.join(
    REPO_ROOT,
    ".cursor/aaac/state/campaigns",
    campaignId,
    "journal.md",
  );
  fs.appendFileSync(journalPath, `\n${line}\n`);
}
