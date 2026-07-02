#!/usr/bin/env node
/**
 * Synthesize check-swarm-raw.json from Fallow health targets (scriptable check_swarm).
 */
import fs from "fs";
import path from "path";
import { isoNow } from "../run-engine/lib.mjs";
import { campaignDir, iterDir } from "./lib/runner-state.mjs";
import { loadCampaignContext } from "./lib/campaign-focus.mjs";
import {
  fetchHealthTargets,
  filterTargetsForWaves,
} from "./lib/fallow-health-targets.mjs";

const AGENT_IDS = [
  "remediation-check-app-inventory",
  "remediation-check-app-ssot",
  "remediation-check-app-trace",
  "remediation-check-architecture-boundaries",
  "remediation-check-architecture-deps",
  "remediation-check-architecture-decomposition",
  "remediation-check-risk",
];

function parseArgs(argv) {
  const out = { campaignId: null, iteration: 0 };
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
const { targets, score } = fetchHealthTargets({ scope: ctx.scope, limit: 15 });
const filtered = filterTargetsForWaves(targets, {
  protected_paths: ctx.protected_paths,
  defer_high_fan_in: ctx.focus.defer_high_fan_in,
});

const safeToFix = filtered.slice(0, 8).map((t) => ({
  path: t.path,
  category: "health_decompose",
  evidence: t.recommendation ?? null,
}));

const baseFinding = `health ${score ?? "?"}; focus=${ctx.focus.health_functions_above_60_loc ? "functions>60LOC" : "general"}`;

const agents = AGENT_IDS.map((agent_id) => ({
  agent_id,
  command_mirror: agent_id.includes("risk") ? "check-risk" : agent_id.includes("architecture") ? "check-architecture" : "check-app",
  answer: "partial",
  confidence: "high",
  false_positives: [],
  protected_paths: ctx.protected_paths,
  do_not_delete: ctx.protected_paths.map((p) => ({ path: p, reason: "protected" })),
  safe_to_fix: safeToFix,
  findings: [baseFinding, `auto-synthesis iter ${args.iteration}`],
  gaps: [],
}));

const outPath = path.join(iterDir(args.campaignId, args.iteration), "check-swarm-raw.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify({ merged_at: isoNow(), iteration: args.iteration, focus: ctx.focus, agents }, null, 2),
);

console.log(JSON.stringify({ ok: true, path: outPath, agents: agents.length, safe_to_fix: safeToFix.length }));
