#!/usr/bin/env node
/**
 * Remediation CLI — foreground watch with readable progress for Cursor terminal.
 *
 * Usage:
 *   node remediation-cli.mjs watch --run-id <id> --campaign-id <id>
 *   node remediation-cli.mjs status --campaign-id <id> [--run-id <id>]
 *   node remediation-cli.mjs cursor --run-id <id> --campaign-id <id>
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { REPO_ROOT, readJson } from "../run-engine/lib.mjs";
import { campaignDir } from "./lib/runner-state.mjs";
import {
  buildProgressSnapshot,
  formatProgressLine,
  writeProgressArtifact,
} from "./lib/remediation-progress.mjs";
import { runRemediationWatchLoop } from "./lib/remediation-watch-loop.mjs";
import { resolveCursorBin } from "./lib/invoke-cursor-agent.mjs";

function parseArgs(argv) {
  const out = {
    command: argv[0] ?? "help",
    runId: null,
    campaignId: null,
    pollMs: 5000,
    maxRetries: 5,
  };
  const rest = argv[0]?.startsWith("-") ? argv : argv.slice(1);
  if (!argv[0]?.startsWith("-")) {
    out.command = argv[0] ?? "help";
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "watch" || a === "status" || a === "cursor" || a === "help") out.command = a;
    else if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--poll-ms") out.pollMs = Number(argv[++i]);
    else if (a === "--max-retries") out.maxRetries = Number(argv[++i]);
  }
  return out;
}

function printBanner(args) {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Remediation watch — health focus until satisfaction goal");
  console.log(`  campaign: ${args.campaignId}`);
  console.log(`  run:      ${args.runId}`);
  console.log(`  progress: .cursor/aaac/state/campaigns/${args.campaignId}/progress.json`);
  console.log("  Ctrl+C to stop (campaign state is persisted; resume with watch)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
}

function cmdStatus(args) {
  if (!args.campaignId) {
    console.error("status requires --campaign-id");
    process.exit(2);
  }
  const snap = buildProgressSnapshot(args.campaignId, args.runId ?? "—");
  writeProgressArtifact(args.campaignId, snap);
  console.log(formatProgressLine(snap));
  console.log(JSON.stringify(snap, null, 2));
}

async function cmdWatch(args) {
  if (!args.runId || !args.campaignId) {
    console.error("watch requires --run-id and --campaign-id");
    process.exit(2);
  }
  printBanner(args);
  const code = await runRemediationWatchLoop({
    ...args,
    reporter: {
      onProgress: (snap, event) => {
        console.log(formatProgressLine(snap, event));
      },
      onEvent: (event, detail) => {
        if (event === "handle_failed" || event === "blocked" || event === "runner_error") {
          console.log(`  ⚠ ${event}: ${(detail.stderr ?? detail.message ?? JSON.stringify(detail)).slice(0, 200)}`);
        }
        if (event === "goal_achieved" || event === "runner_complete") {
          console.log("");
          console.log("✓ Remediation campaign complete.");
        }
      },
    },
  });
  process.exit(code);
}

function cmdCursor(args) {
  if (!args.runId || !args.campaignId) {
    console.error("cursor requires --run-id and --campaign-id");
    process.exit(2);
  }
  const bin = resolveCursorBin();
  if (!bin) {
    console.error("cursor CLI not found");
    process.exit(127);
  }
  const cliPath = path.join(REPO_ROOT, ".cursor/aaac/scripts/remediation/remediation-cli.mjs");
  const watchCmd = `node ${cliPath} watch --run-id ${args.runId} --campaign-id ${args.campaignId}`;
  const prompt = [
    "You are driving an autonomous remediation campaign until satisfaction threshold is met.",
    "Run this command in the FOREGROUND with live stdout (never background it):",
    watchCmd,
    "Summarize each [remediate] progress line. If the command exits non-zero, diagnose from progress.json and retry watch once.",
    "Do not stop until watch exits 0 (goal achieved) or reports blocked.",
  ].join("\n");

  console.log("Launching Cursor agent with foreground remediation watch…");
  console.log(`Command: ${watchCmd}`);
  console.log("");

  const result = spawnSync(bin, ["agent", "-p", "-f", "--approve-mcps", "--output-format", "text", prompt], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

function cmdHelp() {
  console.log(`Usage:
  node remediation-cli.mjs watch --run-id <id> --campaign-id <id>
  node remediation-cli.mjs status --campaign-id <id> [--run-id <id>]
  node remediation-cli.mjs cursor --run-id <id> --campaign-id <id>

Recommended (Cursor integrated terminal — readable live progress):
  node .cursor/aaac/scripts/remediation/remediation-cli.mjs watch \
    --run-id run_20260618_remediate-app-frontend-9431df20 \
    --campaign-id campaign_20260618_remediate-app-health

Or via Cursor agent CLI (agent session monitors the watch command):
  node .cursor/aaac/scripts/remediation/remediation-cli.mjs cursor \
    --run-id <run_id> --campaign-id <campaign_id>
`);
}

const args = parseArgs(process.argv.slice(2));
switch (args.command) {
  case "watch":
    cmdWatch(args);
    break;
  case "status":
    cmdStatus(args);
    break;
  case "cursor":
    cmdCursor(args);
    break;
  default:
    cmdHelp();
}
