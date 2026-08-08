#!/usr/bin/env node
/**
 * Build plan_waves.yaml from dispatch-queue.yaml (scriptable plan_waves phase).
 *
 * Usage:
 *   node plan-waves-from-queue.mjs --campaign-id <id> --run-id <run_id> [--iteration <n>]
 */
import fs from "fs";
import path from "path";
import {
  campaignDir,
  loadCampaign,
  runArtifactsDir,
} from "./lib/runner-state.mjs";
import {
  buildPlanWavesYaml,
  copyFileIfExists,
  journal,
  parseDispatchQueueYaml,
  writeRunArtifact,
} from "./lib/runner-exec.mjs";

function parseArgs(argv) {
  const out = { campaignId: null, runId: null, iteration: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId || !args.runId) {
  console.error("plan-waves-from-queue: --campaign-id and --run-id required");
  process.exit(2);
}

const campaign = loadCampaign(args.campaignId);
if (!campaign) {
  console.error(`Campaign not found: ${args.campaignId}`);
  process.exit(2);
}

const iteration = args.iteration ?? campaign.iteration;
const queuePath = path.join(campaignDir(args.campaignId), "dispatch-queue.yaml");
if (!fs.existsSync(queuePath)) {
  console.error(`Missing dispatch-queue.yaml at ${queuePath}`);
  process.exit(2);
}

const queueText = fs.readFileSync(queuePath, "utf8");
let waves = parseDispatchQueueYaml(queueText);
const maxWaves = campaign.config?.max_waves_per_iteration ?? 3;
waves = waves.slice(0, maxWaves);

if (waves.length === 0) {
  console.error("dispatch-queue.yaml has no waves");
  process.exit(2);
}

const yaml = buildPlanWavesYaml({ campaign: { ...campaign, iteration }, waves });
const campaignPlan = path.join(campaignDir(args.campaignId), "artifacts", "plan_waves.yaml");
const runPlan = path.join(runArtifactsDir(args.runId), "plan_waves.yaml");
fs.mkdirSync(path.dirname(campaignPlan), { recursive: true });
fs.writeFileSync(campaignPlan, yaml);
fs.mkdirSync(path.dirname(runPlan), { recursive: true });
fs.writeFileSync(runPlan, yaml);

journal(
  args.campaignId,
  `- **Plan waves** iter ${iteration}: ${waves.length} wave(s) from dispatch-queue.yaml`,
);

console.log(
  JSON.stringify({
    ok: true,
    campaign_id: args.campaignId,
    iteration,
    wave_count: waves.length,
    plan_path: runPlan,
    waves: waves.map((w) => ({ index: w.index, command: w.command, priority: w.priority })),
  }),
);
