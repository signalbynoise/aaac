#!/usr/bin/env node
/**
 * Append a structured step record to campaign journal and optionally advance iteration.
 *
 * Usage:
 *   node record-iteration-step.mjs --campaign-id <id> --step <name> --detail "<text>" [--status pass|fail]
 */
import fs from "fs";
import path from "path";
import { REPO_ROOT, isoNow, readJson, writeJson } from "../run-engine/lib.mjs";

const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

function parseArgs(argv) {
  const out = { campaignId: null, step: "step", detail: "", status: "info", iteration: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--step") out.step = argv[++i];
    else if (a === "--detail") out.detail = argv[++i];
    else if (a === "--status") out.status = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("record-iteration-step: --campaign-id required");
  process.exit(2);
}

const dir = path.join(CAMPAIGNS_ROOT, args.campaignId);
const stepsPath = path.join(dir, "steps.jsonl");
const line = JSON.stringify({
  at: isoNow(),
  step: args.step,
  status: args.status,
  detail: args.detail,
  iteration: args.iteration,
});
fs.appendFileSync(stepsPath, `${line}\n`);

const journal = `\n- \`${args.step}\` (${args.status}) — ${args.detail}\n`;
fs.appendFileSync(path.join(dir, "journal.md"), journal);

if (args.iteration !== null) {
  const campaign = readJson(path.join(dir, "campaign.json"));
  if (campaign) {
    campaign.iteration = args.iteration;
    campaign.updated_at = isoNow();
    writeJson(path.join(dir, "campaign.json"), campaign);
  }
}

console.log(JSON.stringify({ ok: true }));
