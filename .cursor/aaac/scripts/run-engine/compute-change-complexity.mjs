#!/usr/bin/env node
/**
 * Compute change complexity score and persist artifacts/change_complexity.yaml
 * Usage: node compute-change-complexity.mjs --run-id <id> --source plan|post_impact
 */
import { loadEnforcement } from "./lib.mjs";
import { loadSwarmSizing } from "./load-swarm-sizing.mjs";
import { applySwarmTargetsToManifest } from "./resolve-swarm-target.mjs";
import {
  computeChangeScore,
  loadManifestOrThrow,
  persistChangeComplexity,
  saveManifest,
} from "./swarm-complexity-lib.mjs";

function parseArgs(argv) {
  const out = { runId: null, source: "plan" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run-id") out.runId = argv[++i];
    if (argv[i] === "--source") out.source = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.runId) {
  console.error("Usage: compute-change-complexity.mjs --run-id <run_id> [--source plan|post_impact]");
  process.exit(2);
}

const enforcement = loadEnforcement();
const sizing = loadSwarmSizing(enforcement);
const manifest = loadManifestOrThrow(args.runId);

const result = computeChangeScore(args.runId, manifest, sizing, args.source);
result.modifiers = { source: args.source };
persistChangeComplexity(args.runId, manifest, result);

const changePhases = sizing.phase_classes?.change_driven ?? [];
const pendingChange = (manifest.pending ?? []).filter((p) => changePhases.includes(p));
applySwarmTargetsToManifest(manifest, pendingChange.length ? pendingChange : changePhases, enforcement);

if (args.source === "post_impact") {
  applySwarmTargetsToManifest(manifest, ["verify", "review_swarm", "report"], enforcement);
}

saveManifest(args.runId, manifest);

console.log(
  JSON.stringify({
    ok: true,
    run_id: args.runId,
    source: args.source,
    change_score: result.score,
    targets: manifest.swarm?.target_agents ?? {},
  }),
);
