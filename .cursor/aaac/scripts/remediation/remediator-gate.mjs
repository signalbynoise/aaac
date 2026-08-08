#!/usr/bin/env node
/**
 * Agentic OS remediator sub-loop with two-tier validation:
 *   wave  — regression gate (pre-existing debt does not block wave promotion)
 *   debt  — strict gate (all layers must pass; used by debt_sweep phase)
 *   iteration — strict (legacy alias for debt within an iteration)
 *
 * Exit codes:
 *   0 — promote (wave regression-clean OR strict pass OR wave deferred to debt_sweep)
 *   1 — blocked (debt/infra exhausted — campaign cannot satisfy)
 *   2 — runtime error
 *   3 — remediate required (agent MUST fix and re-run; never treat as stop)
 *
 * Usage:
 *   node remediator-gate.mjs --campaign-id <id> --iteration <n> --mode wave|debt|iteration \
 *     [--wave-index <w>] [--run-id <run_id>] [--attempt <n>] [--skip-verify]
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { REPO_ROOT, isoNow, readJson, writeJson, runDir } from "../run-engine/lib.mjs";
import { analyzeRegression } from "./lib/regression-analysis.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");
const VERIFY_SCRIPT = path.join(__dirname, "verify-remediation-iteration.mjs");
const CLASSIFY_SCRIPT = path.join(__dirname, "classify-verify-failure.mjs");
const RULES = readJson(path.join(__dirname, "dispatch-rules.json"), {});

function parseArgs(argv) {
  const out = {
    campaignId: null,
    iteration: 0,
    mode: "wave",
    waveIndex: null,
    runId: null,
    attempt: 1,
    skipVerify: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--mode") out.mode = argv[++i];
    else if (a === "--wave-index") out.waveIndex = Number(argv[++i]);
    else if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--attempt") out.attempt = Number(argv[++i]);
    else if (a === "--skip-verify") out.skipVerify = true;
  }
  return out;
}

function campaignDir(id) {
  return path.join(CAMPAIGNS_ROOT, id);
}

function iterDir(campaignId, iteration) {
  return path.join(campaignDir(campaignId), "iterations", String(iteration));
}

function remediatorStatePath(campaignId, iteration, mode, waveIndex) {
  const base = iterDir(campaignId, iteration);
  const key = mode === "wave" && waveIndex != null ? `wave-${waveIndex}` : mode;
  return path.join(base, `remediator-loop-${key}.json`);
}

function appendJournal(campaignId, text) {
  fs.appendFileSync(path.join(campaignDir(campaignId), "journal.md"), text);
}

function gateMode(campaign, mode) {
  if (mode === "wave") {
    return campaign?.config?.wave_gate_mode ?? "regression";
  }
  return "strict";
}

function maxAttempts(campaign, mode) {
  const cfg = campaign?.config ?? {};
  if (mode === "debt" || mode === "iteration") {
    return cfg.max_remediator_attempts_per_debt_round ?? cfg.max_remediator_attempts_per_iteration ?? RULES.defaults?.max_remediator_attempts_per_iteration ?? 3;
  }
  return cfg.max_remediator_attempts_per_wave ?? RULES.defaults?.max_remediator_attempts_per_wave ?? 3;
}

function verifyFileForMode(dir, mode) {
  if (mode === "wave") return path.join(dir, "verify-wave.json");
  if (mode === "debt") return path.join(dir, "verify-debt.json");
  return path.join(dir, "verify-iteration.json");
}

function runVerify(args) {
  const verifyMode = args.mode === "iteration" ? "debt" : args.mode;
  const verifyArgs = [
    VERIFY_SCRIPT,
    "--campaign-id",
    args.campaignId,
    "--iteration",
    String(args.iteration),
    "--mode",
    verifyMode,
  ];
  if (args.runId) verifyArgs.push("--run-id", args.runId);
  const result = spawnSync(process.execPath, verifyArgs, { encoding: "utf8" });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout.trim().split("\n").pop());
  } catch {
    parsed = { ok: false, parse_error: true };
  }
  return { exitCode: result.status, parsed, stdout: result.stdout, stderr: result.stderr };
}

function classify(reportPath, ctx, layersFilter = null) {
  const classifyArgs = [
    CLASSIFY_SCRIPT,
    "--report",
    reportPath,
    "--campaign-id",
    ctx.campaignId,
    "--iteration",
    String(ctx.iteration),
    "--attempt",
    String(ctx.attempt),
  ];
  if (ctx.waveIndex != null) classifyArgs.push("--wave-index", String(ctx.waveIndex));
  const result = spawnSync(process.execPath, classifyArgs, { encoding: "utf8" });
  try {
    const out = JSON.parse(result.stdout.trim());
    if (layersFilter?.length && out.classification) {
      out.classification.handoffs = (out.classification.handoffs ?? []).filter((h) =>
        layersFilter.includes(h.layer),
      );
      out.classification.failed_layers = (out.classification.failed_layers ?? []).filter((l) =>
        layersFilter.includes(l),
      );
      out.classification.primary =
        out.classification.handoffs.find((h) => h.command) ?? out.classification.handoffs[0] ?? null;
      out.classification.status = out.classification.handoffs.length ? "fail" : "pass";
    }
    return out;
  } catch {
    return { ok: false, error: "classify parse failed", stderr: result.stderr };
  }
}

function writeHandoffArtifact(dir, attempt, payload) {
  const handoffPath = path.join(dir, `remediator-handoff-attempt-${attempt}.json`);
  writeJson(handoffPath, payload);
  return handoffPath;
}

function loadRegressionContext(campaignId, iteration, waveIndex) {
  const dir = iterDir(campaignId, iteration);
  const campaignRoot = campaignDir(campaignId);
  const preWave = waveIndex != null ? readJson(path.join(dir, `wave-${waveIndex}-pre.json`), null) : null;
  const campaignBaseline = readJson(path.join(campaignRoot, "verify-baseline.json"), null);
  return { preWave, campaignBaseline };
}

function promotePayload({ args, verifyFile, statePath, loopState, extra }) {
  loopState.status = "promoted";
  loopState.promoted_at = isoNow();
  loopState.final_attempt = args.attempt;
  writeJson(statePath, loopState);

  const output = {
    action: extra?.action ?? "promote",
    status: "pass",
    attempt: args.attempt,
    verify_path: verifyFile,
    loop_state_path: statePath,
    campaign_must_continue: extra?.campaign_must_continue ?? false,
    ...extra,
  };
  if (args.runId) {
    writeJson(path.join(runDir(args.runId), "artifacts", `remediator_gate_${args.mode}.json`), output);
  }
  return output;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("remediator-gate: --campaign-id required");
  process.exit(2);
}

const campaign = readJson(path.join(campaignDir(args.campaignId), "campaign.json"), {});
const mode = args.mode === "iteration" ? "debt" : args.mode;
const gMode = gateMode(campaign, mode === "wave" ? "wave" : "debt");
const max = maxAttempts(campaign, mode);
const dir = iterDir(args.campaignId, args.iteration);
fs.mkdirSync(dir, { recursive: true });

const verifyFile = verifyFileForMode(dir, mode);

if (!args.skipVerify) {
  runVerify({ ...args, mode });
}

if (!fs.existsSync(verifyFile)) {
  console.error("remediator-gate: verify report missing after run");
  process.exit(2);
}

const report = readJson(verifyFile, {});
const statePath = remediatorStatePath(args.campaignId, args.iteration, mode, args.waveIndex);
let loopState = readJson(statePath, {
  mode,
  wave_index: args.waveIndex,
  gate_mode: gMode,
  attempts: [],
  status: "running",
});

const { preWave, campaignBaseline } = loadRegressionContext(
  args.campaignId,
  args.iteration,
  args.waveIndex,
);
const regression = analyzeRegression({
  current: report,
  preWave: preWave ?? campaignBaseline,
  campaignBaseline,
});

const strictPass = regression.strict_pass;
const isWaveRegression = mode === "wave" && gMode === "regression";

if (strictPass || (isWaveRegression && !regression.introduced_regression)) {
  const debtRemaining = regression.debt_remaining;
  const action = isWaveRegression && debtRemaining ? "promote_wave" : "promote";
  const output = promotePayload({
    args: { ...args, mode },
    verifyFile,
    statePath,
    loopState,
    extra: {
      action,
      gate_mode: gMode,
      introduced_regression: regression.introduced_regression,
      debt_remaining: debtRemaining,
      campaign_must_continue: debtRemaining || isWaveRegression,
      regression_analysis: regression,
      message: isWaveRegression && debtRemaining
        ? "Wave promoted — no new regression; pre-existing debt deferred to debt_sweep"
        : "All verification layers pass",
    },
  });

  appendJournal(
    args.campaignId,
    `- Remediator gate **${action}** ${mode} iter ${args.iteration}${args.waveIndex != null ? ` wave ${args.waveIndex}` : ""} (attempt ${args.attempt}, debt_remaining=${debtRemaining})\n`,
  );
  console.log(JSON.stringify(output));
  process.exit(0);
}

const layersFilter =
  isWaveRegression && regression.introduced_layers?.length
    ? regression.introduced_layers
    : null;

const classificationResult = classify(verifyFile, args, layersFilter);
const classification = classificationResult.classification ?? { handoffs: [], primary: null };

const infra = classification.handoffs?.find((h) => h.level === "infrastructure");
if (infra) {
  const payload = {
    action: "infrastructure",
    status: "blocked",
    attempt: args.attempt,
    handoff: infra.handoff,
    layer: infra.layer,
    verify_path: verifyFile,
    campaign_must_continue: false,
    message: "Infrastructure prerequisite failed — run handoff then retry",
  };
  writeHandoffArtifact(dir, args.attempt, payload);
  appendJournal(args.campaignId, `- Remediator gate: **INFRA** ${infra.handoff}\n`);
  console.log(JSON.stringify(payload));
  process.exit(1);
}

const attemptRecord = {
  attempt: args.attempt,
  at: isoNow(),
  gate_mode: gMode,
  introduced_regression: regression.introduced_regression,
  failed_layers: classification.failed_layers ?? [],
  primary: classification.primary,
  verify_path: verifyFile,
  regression_analysis: regression,
};
loopState.attempts.push(attemptRecord);
loopState.updated_at = isoNow();
writeJson(statePath, loopState);

if (args.attempt >= max) {
  if (isWaveRegression) {
    loopState.status = "deferred_to_debt_sweep";
    loopState.deferred_at = isoNow();
    loopState.deferred_reason = "max_remediator_attempts_wave_regression";
    writeJson(statePath, loopState);

    const payload = promotePayload({
      args: { ...args, mode },
      verifyFile,
      statePath,
      loopState,
      extra: {
        action: "defer_to_debt_sweep",
        gate_mode: gMode,
        reason: "max_remediator_attempts",
        attempt: args.attempt,
        max_attempts: max,
        classification,
        campaign_must_continue: true,
        message: "Wave regression not fixed in max attempts — deferred to debt_sweep; continue remaining waves",
      },
    });
    writeHandoffArtifact(dir, args.attempt, payload);
    appendJournal(
      args.campaignId,
      `- Remediator wave **DEFERRED** to debt_sweep after ${args.attempt}/${max} attempts\n`,
    );
    console.log(JSON.stringify(payload));
    process.exit(0);
  }

  loopState.status = "blocked";
  loopState.blocked_at = isoNow();
  loopState.blocked_reason = "max_remediator_attempts";
  writeJson(statePath, loopState);

  const payload = {
    action: "block",
    status: "fail",
    reason: "max_remediator_attempts",
    attempt: args.attempt,
    max_attempts: max,
    gate_mode: gMode,
    classification,
    verify_path: verifyFile,
    loop_state_path: statePath,
    campaign_must_continue: false,
    manual_handoff: classification.primary?.slash_command ?? null,
  };
  writeHandoffArtifact(dir, args.attempt, payload);
  appendJournal(
    args.campaignId,
    `- Remediator gate **BLOCKED** after ${args.attempt}/${max} attempts (${(classification.failed_layers ?? []).join(", ")})\n`,
  );
  if (args.runId) {
    writeJson(path.join(runDir(args.runId), "artifacts", `remediator_gate_${mode}.json`), payload);
  }
  console.log(JSON.stringify(payload));
  process.exit(1);
}

const primary = classification.primary;
const payload = {
  action: "remediate",
  status: "fail",
  attempt: args.attempt,
  max_attempts: max,
  next_attempt: args.attempt + 1,
  gate_mode: gMode,
  introduced_regression: regression.introduced_regression,
  introduced_layers: regression.introduced_layers,
  failed_layers: classification.failed_layers,
  campaign_must_continue: true,
  orchestrator_must_not_stop: true,
  orchestrator_must_not_set_blocked: true,
  handoff: primary
    ? {
        command: primary.command,
        domain: primary.domain,
        intent: primary.intent,
        layer: primary.layer,
        level: primary.level,
        file_paths: primary.file_paths,
        log_path: report[primary.layer]?.log_path ?? null,
      }
    : null,
  all_handoffs: classification.handoffs,
  verify_path: verifyFile,
  loop_state_path: statePath,
  regression_analysis: regression,
  retry_command: `node .cursor/aaac/scripts/remediation/remediator-gate.mjs --campaign-id ${args.campaignId} --iteration ${args.iteration} --mode ${mode}${args.waveIndex != null ? ` --wave-index ${args.waveIndex}` : ""}${args.runId ? ` --run-id ${args.runId}` : ""} --attempt ${args.attempt + 1}`,
};

const handoffPath = writeHandoffArtifact(dir, args.attempt, payload);
appendJournal(
  args.campaignId,
  `- Remediator attempt ${args.attempt}/${max}: **${primary?.command ?? "unknown"}** (${primary?.layer}) — handoff \`${handoffPath}\` — **CONTINUE** (exit 3 ≠ stop)\n`,
);

if (args.runId) {
  writeJson(path.join(runDir(args.runId), "artifacts", `remediator_handoff_attempt_${args.attempt}.json`), payload);
}

console.log(JSON.stringify(payload));
process.exit(3);
