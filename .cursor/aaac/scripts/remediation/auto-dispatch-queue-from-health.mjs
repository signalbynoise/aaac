#!/usr/bin/env node
/**
 * Build dispatch-queue.yaml from Fallow health targets + campaign focus.
 */
import fs from "fs";
import path from "path";
import { campaignDir, loadCampaign } from "./lib/runner-state.mjs";
import { loadCampaignContext, normalizeRepoPath } from "./lib/campaign-focus.mjs";
import {
  fetchHealthTargets,
  filterTargetsForWaves,
  targetToWaveIntent,
} from "./lib/fallow-health-targets.mjs";
import { journal } from "./lib/runner-exec.mjs";

function parseArgs(argv) {
  const out = { campaignId: null, iteration: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--campaign-id") out.campaignId = argv[++i];
    else if (argv[i] === "--iteration") out.iteration = Number(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("--campaign-id required");
  process.exit(2);
}

const ctx = loadCampaignContext(args.campaignId);
const campaign = ctx.campaign;
const iteration = args.iteration ?? campaign.iteration ?? 0;
const maxWaves = campaign.config?.max_waves_per_iteration ?? 3;

const { targets } = fetchHealthTargets({ scope: ctx.scope, limit: 20 });
const filtered = filterTargetsForWaves(targets, {
  protected_paths: ctx.protected_paths,
  defer_high_fan_in: ctx.focus.defer_high_fan_in,
}).slice(0, maxWaves);

if (filtered.length === 0) {
  console.error("No health targets available for waves");
  process.exit(2);
}

const lines = [
  `# iteration ${iteration} health waves — auto from Fallow targets`,
  `iteration: ${iteration}`,
  `campaign_id: ${args.campaignId}`,
  `scope: ${ctx.scope}`,
  `intent_focus: health`,
  "",
  "protected_paths:",
  ...ctx.protected_paths.map((p) => `  - ${p}`),
  "",
  "waves:",
];

for (let i = 0; i < filtered.length; i++) {
  const t = filtered[i];
  const risk = t.effort === "high" ? "medium" : "low";
  lines.push(`- priority: ${i + 1}`);
  lines.push(`  command: fix-module`);
  lines.push(`  intent: ${targetToWaveIntent(t)}`);
  lines.push(`  risk: ${risk}`);
}

const yaml = `${lines.join("\n")}\n`;
const dest = path.join(campaignDir(args.campaignId), "dispatch-queue.yaml");
const artifact = path.join(campaignDir(args.campaignId), "artifacts", "dispatch-queue.yaml");
fs.writeFileSync(dest, yaml);
fs.mkdirSync(path.dirname(artifact), { recursive: true });
fs.writeFileSync(artifact, yaml);

journal(args.campaignId, `- **Auto dispatch-queue** iter ${iteration}: ${filtered.length} health wave(s)`);

console.log(JSON.stringify({ ok: true, waves: filtered.length, paths: filtered.map((t) => t.path) }));
