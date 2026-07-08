#!/usr/bin/env node
/**
 * Compute scope complexity score and persist artifacts/scope_complexity.yaml
 * Usage: node compute-scope-complexity.mjs --run-id <id> --source bootstrap|discover|remediation_scan
 */
import { loadEnforcement } from "./lib.mjs";
import { loadSwarmSizing } from "./load-swarm-sizing.mjs";
import { applySwarmTargetsToManifest } from "./resolve-swarm-target.mjs";
import {
  computeBootstrapScopeScore,
  computeDiscoverScopeScore,
  computeRemediationScanScopeScore,
  loadManifestOrThrow,
  persistScopeComplexity,
  readArtifactYaml,
  saveManifest,
} from "./swarm-complexity-lib.mjs";

function parseArgs(argv) {
  const out = { runId: null, source: "bootstrap" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run-id") out.runId = argv[++i];
    if (argv[i] === "--source") out.source = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.runId) {
  console.error("Usage: compute-scope-complexity.mjs --run-id <run_id> [--source bootstrap|discover|remediation_scan]");
  process.exit(2);
}

const enforcement = loadEnforcement();
const sizing = loadSwarmSizing(enforcement);
const manifest = loadManifestOrThrow(args.runId);

let result;
if (args.source === "bootstrap") {
  result = computeBootstrapScopeScore(manifest, sizing);
  result.source = "bootstrap";
} else if (args.source === "discover") {
  const brief = readArtifactYaml(args.runId, "artifacts/discover_brief.yaml");
  result = computeDiscoverScopeScore(brief, manifest, sizing);
  result.source = "discover";
} else if (args.source === "remediation_scan") {
  result = computeRemediationScanScopeScore(args.runId, sizing);
  result.source = "remediation_scan";
} else {
  console.error(`Unknown source: ${args.source}`);
  process.exit(2);
}

persistScopeComplexity(args.runId, manifest, result);

const scopePhases = sizing.phase_classes?.scope_driven ?? [];
const pendingScope = (manifest.pending ?? []).filter((p) => scopePhases.includes(p));
applySwarmTargetsToManifest(manifest, pendingScope.length ? pendingScope : scopePhases, enforcement);

if (manifest.phase && scopePhases.includes(manifest.phase)) {
  applySwarmTargetsToManifest(manifest, [manifest.phase], enforcement);
}

saveManifest(args.runId, manifest);

console.log(
  JSON.stringify({
    ok: true,
    run_id: args.runId,
    source: result.source,
    scope_score: result.score,
    targets: manifest.swarm?.target_agents ?? {},
  }),
);
