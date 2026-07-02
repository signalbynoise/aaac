#!/usr/bin/env node
/**
 * Multi-layer verification gate for remediation campaigns.
 *
 * Modes:
 *   wave      — fast gate after each fix wave (typecheck, vitest, go test)
 *   iteration — full gate (+ build + Playwright)
 *   debt      — strict full gate (same layers as iteration; used by debt_sweep)
 *   strict    — alias for debt
 *
 * Usage:
 *   node verify-remediation-iteration.mjs --campaign-id <id> --iteration <n> \
 *     --mode wave|iteration|debt [--run-id <run_id>] [--label <suffix>]
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { REPO_ROOT, isoNow, writeJson, runDir } from "../run-engine/lib.mjs";
import {
  runVerifySteps,
  writeVerifyLogs,
} from "./lib/verify-metrics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

function parseArgs(argv) {
  const out = { campaignId: null, iteration: 0, mode: "iteration", runId: null, label: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--mode") out.mode = argv[++i];
    else if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--label") out.label = argv[++i];
  }
  return out;
}

function appendJournal(campaignId, text) {
  fs.appendFileSync(path.join(CAMPAIGNS_ROOT, campaignId, "journal.md"), text);
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("verify-remediation-iteration: --campaign-id required");
  process.exit(2);
}

const verifyMode = args.mode === "strict" ? "debt" : args.mode;
const iterDir = path.join(CAMPAIGNS_ROOT, args.campaignId, "iterations", String(args.iteration));
const logDir = path.join(iterDir, "verify-logs");
fs.mkdirSync(iterDir, { recursive: true });

const stepMode = verifyMode === "wave" ? "wave" : "debt";
const report = await runVerifySteps(stepMode);
report.iteration = args.iteration;
report.campaign_id = args.campaignId;
report.label = args.label;

writeVerifyLogs(report, logDir, args.label ?? verifyMode);

const outName =
  args.label != null
    ? `verify-${args.label}.json`
    : verifyMode === "wave"
      ? "verify-wave.json"
      : verifyMode === "debt"
        ? "verify-debt.json"
        : "verify-iteration.json";
const outPath = path.join(iterDir, outName);
writeJson(outPath, report);

if (report.status === "fail") {
  const classify = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "classify-verify-failure.mjs"),
      "--report",
      outPath,
      "--campaign-id",
      args.campaignId,
      "--iteration",
      String(args.iteration),
    ],
    { encoding: "utf8" },
  );
  try {
    const line = classify.stdout.trim().split("\n").pop();
    report.failure_classification = JSON.parse(line)?.classification ?? null;
    writeJson(outPath, report);
  } catch {
    report.failure_classification = null;
  }
}

appendJournal(
  args.campaignId,
  `- Verify **${verifyMode}**${args.label ? ` (${args.label})` : ""} iter ${args.iteration}: **${report.status.toUpperCase()}** — total_errors=${report.metrics?.total_errors ?? 0}\n`,
);

if (args.runId) {
  const artifactName = args.label
    ? `verify_${args.label}_iter_${args.iteration}.json`
    : `verify_${verifyMode}_iter_${args.iteration}.json`;
  writeJson(path.join(runDir(args.runId), "artifacts", artifactName), report);
}

const strictPass = report.status === "pass" && (report.metrics?.total_errors ?? 0) === 0;
console.log(JSON.stringify({ ok: strictPass, report, strict_pass: strictPass }));
process.exit(strictPass ? 0 : 1);
