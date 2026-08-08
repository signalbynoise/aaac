#!/usr/bin/env node
/**
 * Snapshot verify metrics immediately before a cleanup wave executes.
 *
 * Usage:
 *   node capture-wave-snapshot.mjs --campaign-id <id> --iteration <n> --wave-index <w>
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { REPO_ROOT, isoNow, writeJson } from "../run-engine/lib.mjs";
import { summarizeMetrics } from "./lib/verify-metrics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");
const VERIFY_SCRIPT = path.join(__dirname, "verify-remediation-iteration.mjs");

function parseArgs(argv) {
  const out = { campaignId: null, iteration: 0, waveIndex: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--campaign-id") out.campaignId = argv[++i];
    else if (argv[i] === "--iteration") out.iteration = Number(argv[++i]);
    else if (argv[i] === "--wave-index") out.waveIndex = Number(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("capture-wave-snapshot: --campaign-id required");
  process.exit(2);
}

spawnSync(
  process.execPath,
  [
    VERIFY_SCRIPT,
    "--campaign-id",
    args.campaignId,
    "--iteration",
    String(args.iteration),
    "--mode",
    "wave",
    "--label",
    `pre-wave-${args.waveIndex}`,
  ],
  { encoding: "utf8" },
);

const iterDir = path.join(
  CAMPAIGNS_ROOT,
  args.campaignId,
  "iterations",
  String(args.iteration),
);
const prePath = path.join(iterDir, `wave-${args.waveIndex}-pre.json`);
const verifyPath = path.join(iterDir, "verify-wave.json");

let report = null;
try {
  report = JSON.parse(fs.readFileSync(verifyPath, "utf8"));
} catch {
  console.error("capture-wave-snapshot: missing verify-wave.json");
  process.exit(2);
}

const snapshot = {
  captured_at: isoNow(),
  kind: "pre_wave",
  wave_index: args.waveIndex,
  iteration: args.iteration,
  summary: summarizeMetrics(report),
  metrics: report.metrics,
};
writeJson(prePath, snapshot);
fs.copyFileSync(verifyPath, path.join(iterDir, `wave-${args.waveIndex}-pre-verify.json`));

console.log(JSON.stringify({ ok: true, snapshot_path: prePath, summary: snapshot.summary }));
