#!/usr/bin/env node
/**
 * Initialize or resume a remediation campaign for /remediate-app.
 *
 * Usage:
 *   node init-campaign.mjs --run-id <run_id> [--campaign-id <id>] [--resume <id>]
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import {
  REPO_ROOT,
  isoNow,
  readJson,
  runDir,
  slugify,
  writeJson,
} from "../run-engine/lib.mjs";
import { applyAutonomousToConfig } from "./lib/autonomous-mode.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_SCRIPT = path.join(__dirname, "bootstrap-autonomous.mjs");
const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

function parseArgs(argv) {
  const out = {
    runId: null,
    campaignId: null,
    resume: null,
    scope: "whole-repo",
    intent: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--resume") out.resume = argv[++i];
    else if (a === "--scope") out.scope = argv[++i];
    else if (a === "--intent") out.intent = argv[++i];
  }
  return out;
}

function parseIntentConfig(intent) {
  const base = {
    max_iterations: 5,
    max_waves_per_iteration: 3,
    max_remediator_attempts_per_wave: 3,
    max_remediator_attempts_per_iteration: 3,
    max_remediator_attempts_per_debt_round: 3,
    max_debt_sweep_rounds: 10,
    wave_gate_mode: "regression",
    debt_gate_mode: "strict",
    satisfaction_threshold: 85,
    rollback_on_verify_fail: true,
  };
  if (!intent) return applyAutonomousToConfig(base, intent);
  const maxIter = intent.match(/max_iterations\s*=\s*(\d+)/i);
  if (maxIter) base.max_iterations = Number(maxIter[1]);
  const maxWaves = intent.match(/max_waves_per_iteration\s*=\s*(\d+)/i);
  if (maxWaves) base.max_waves_per_iteration = Number(maxWaves[1]);
  const maxRemWave = intent.match(/max_remediator_attempts_per_wave\s*=\s*(\d+)/i);
  if (maxRemWave) base.max_remediator_attempts_per_wave = Number(maxRemWave[1]);
  const maxRemIter = intent.match(/max_remediator_attempts_per_iteration\s*=\s*(\d+)/i);
  if (maxRemIter) base.max_remediator_attempts_per_iteration = Number(maxRemIter[1]);
  const maxDebtRounds = intent.match(/max_debt_sweep_rounds\s*=\s*(\d+)/i);
  if (maxDebtRounds) base.max_debt_sweep_rounds = Number(maxDebtRounds[1]);
  const maxDebtAttempts = intent.match(/max_remediator_attempts_per_debt_round\s*=\s*(\d+)/i);
  if (maxDebtAttempts) base.max_remediator_attempts_per_debt_round = Number(maxDebtAttempts[1]);
  const threshold = intent.match(/satisfaction_threshold\s*=\s*(\d+)/i);
  if (threshold) base.satisfaction_threshold = Number(threshold[1]);
  return applyAutonomousToConfig(base, intent);
}

function campaignDir(campaignId) {
  return path.join(CAMPAIGNS_ROOT, campaignId);
}

function appendJournal(campaignId, line) {
  const journalPath = path.join(campaignDir(campaignId), "journal.md");
  const header =
    fs.existsSync(journalPath) ? "" : "# Remediation campaign journal\n\n";
  fs.appendFileSync(journalPath, `${header}${line}\n`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.runId) {
  console.error("init-campaign: --run-id required");
  process.exit(2);
}

const manifest = readJson(path.join(runDir(args.runId), "run.json"), {});
const intent = args.intent || manifest.intent || "";
const config = parseIntentConfig(intent);

let campaignId = args.resume || args.campaignId;
const now = isoNow();
const date = now.slice(0, 10).replace(/-/g, "");

if (!campaignId) {
  const resumeMatch = intent.match(/resume\s+(campaign_[a-z0-9_-]+)/i);
  campaignId = resumeMatch?.[1] ?? `campaign_${date}_${slugify(manifest.command ?? "remediate")}`;
}

const dir = campaignDir(campaignId);
fs.mkdirSync(path.join(dir, "iterations"), { recursive: true });

const isResume = Boolean(args.resume || intent.match(/resume/i));
let campaign = readJson(path.join(dir, "campaign.json"), null);
if (campaign && !isResume) {
  campaign = null;
}

if (!campaign) {
  campaign = {
    campaign_id: campaignId,
    run_id: args.runId,
    conversation_id: manifest.conversation_id ?? null,
    scope: args.scope,
    status: "running",
    intent,
    config,
    iteration: 0,
    waves_completed_total: 0,
    baseline: {
      fallow_total_issues: null,
      fallow_scan_path: null,
      clone_groups: null,
      health_score: null,
      recorded_at: null,
    },
    current: {
      fallow_total_issues: null,
      fallow_dupes_clone_groups: null,
      fallow_health_score: null,
      satisfaction_score: null,
      satisfaction_rate: null,
      e2e_pass: null,
      verify_status: null,
    },
    dispatch_queue_path: "dispatch-queue.yaml",
    debt_sweep: { status: "pending", iteration: null },
    verify_baseline: null,
    created_at: now,
    updated_at: now,
  };
  writeJson(path.join(dir, "campaign.json"), campaign);
  writeJson(path.join(dir, "satisfaction-history.yaml"), { entries: [] });
  appendJournal(
    campaignId,
    `## ${now} — Campaign started\n\n- **Run:** \`${args.runId}\`\n- **Scope:** ${args.scope}\n- **Config:** max_iterations=${config.max_iterations}, threshold=${config.satisfaction_threshold}, autonomous=${config.autonomous}\n`,
  );
} else {
  campaign.run_id = args.runId;
  campaign.intent = intent || campaign.intent;
  campaign.config = { ...campaign.config, ...config };
  campaign.updated_at = now;
  campaign.status = "running";
  writeJson(path.join(dir, "campaign.json"), campaign);
  appendJournal(
    campaignId,
    `## ${now} — Campaign resumed\n\n- **Run:** \`${args.runId}\`\n- **Iteration:** ${campaign.iteration}\n- **Autonomous:** ${campaign.config.autonomous} (${campaign.config.autonomous_reason})\n`,
  );
}

const artifactPath = path.join(runDir(args.runId), "artifacts/campaign.json");
writeJson(artifactPath, {
  campaign_id: campaignId,
  campaign_dir: dir,
  config: campaign.config,
  status: campaign.status,
  iteration: campaign.iteration,
  autonomous: campaign.config.autonomous,
});

let bootstrap = null;
if (campaign.config.autonomous) {
  const boot = spawnSync(
    process.execPath,
    [BOOTSTRAP_SCRIPT, "--run-id", args.runId, "--campaign-id", campaignId],
    { encoding: "utf8" },
  );
  try {
    bootstrap = JSON.parse(boot.stdout.trim().split("\n").pop());
  } catch {
    bootstrap = { ok: false, error: boot.stderr || "bootstrap parse failed" };
  }
}

const out = {
  ok: true,
  campaign_id: campaignId,
  campaign_dir: dir,
  iteration: campaign.iteration,
  config: campaign.config,
  autonomous: campaign.config.autonomous,
  autonomous_reason: campaign.config.autonomous_reason,
  orchestrator_mode: campaign.config.runner_mode,
  bootstrap,
};

if (campaign.config.autonomous && bootstrap?.next_action) {
  out.orchestrator_must = {
    read_skill: bootstrap.skill_required,
    next_action: bootstrap.next_action,
    must_not_end_turn_until: "remediation-runner exit 0 or blocked",
  };
}

console.log(JSON.stringify(out));
