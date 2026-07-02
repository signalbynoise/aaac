#!/usr/bin/env node
/**
 * Compute satisfaction score and remediation rate for a campaign iteration.
 * Fallow components: dead-code (actionable), dupes (clone_groups), health (score).
 *
 * Usage:
 *   node compute-satisfaction.mjs --campaign-id <id> --iteration <n>
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { REPO_ROOT, isoNow, readJson, writeJson } from "../run-engine/lib.mjs";
import { resolveActionableBaseline } from "./lib/fallow-classifier.mjs";
import {
  improvementRate,
  readStartBaseline,
  reductionRate,
  summarizeDeadCode,
  summarizeDupes,
  summarizeHealth,
} from "./lib/fallow-metrics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

const WEIGHTS = {
  fallow_dead_code: 0.25,
  fallow_dupes: 0.1,
  fallow_health: 0.05,
  structural_clean: 0.15,
  unit_tests: 0.15,
  build: 0.1,
  e2e: 0.2,
};

/** @deprecated — use sum of effective fallow weights */
const LEGACY_FALLOW_WEIGHT =
  WEIGHTS.fallow_dead_code + WEIGHTS.fallow_dupes + WEIGHTS.fallow_health;

function parseArgs(argv) {
  const out = { campaignId: null, iteration: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--campaign-id") out.campaignId = argv[++i];
    else if (argv[i] === "--iteration") out.iteration = Number(argv[++i]);
  }
  return out;
}

function scoreComponent(pass, partial = 0) {
  if (pass === true) return 1;
  if (pass === false) return 0;
  return partial;
}

function resolveFallowStartBaseline(campaignDir, campaign) {
  const startPath = path.join(campaignDir, "fallow-start-baseline.json");
  const start = readJson(startPath, null);
  if (start?.fallow_total_issues != null) {
    return { issues: start.fallow_total_issues, source: "fallow-start-baseline.json" };
  }
  if (campaign?.baseline?.immutable && campaign.baseline.fallow_total_issues != null) {
    return { issues: campaign.baseline.fallow_total_issues, source: "campaign.baseline" };
  }
  if (campaign?.baseline?.fallow_total_issues != null) {
    return { issues: campaign.baseline.fallow_total_issues, source: "campaign.baseline.legacy" };
  }
  return { issues: null, source: "none" };
}

function loadLayerSummary(iterDir, file, summarize) {
  const fullPath = path.join(iterDir, file);
  if (!fs.existsSync(fullPath)) return null;
  const payload = readJson(fullPath, {});
  if (payload._remediation?.summary) return payload._remediation.summary;
  return summarize(payload);
}

function normalizeWeights(weights, skipKeys = []) {
  const active = { ...weights };
  for (const key of skipKeys) delete active[key];
  const sum = Object.values(active).reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights;
  const normalized = {};
  for (const [key, value] of Object.entries(active)) {
    normalized[key] = value / sum;
  }
  return normalized;
}

function resolveVerify(iterDir) {
  const debt = readJson(path.join(iterDir, "verify-debt.json"), null);
  if (debt) return { verify: debt, source: "verify-debt.json" };
  const iteration = readJson(path.join(iterDir, "verify-iteration.json"), null);
  if (iteration) return { verify: iteration, source: "verify-iteration.json" };
  return { verify: {}, source: "missing" };
}

function loadClassification(iterDir, campaignId, iteration) {
  const classPath = path.join(iterDir, "fallow-classification.json");
  if (fs.existsSync(classPath)) {
    return readJson(classPath, null);
  }
  spawnSync(
    process.execPath,
    [
      path.join(__dirname, "classify-fallow-issues.mjs"),
      "--campaign-id",
      campaignId,
      "--iteration",
      String(iteration),
    ],
    { encoding: "utf8" },
  );
  return readJson(classPath, null);
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("compute-satisfaction: --campaign-id required");
  process.exit(2);
}

const campaignDir = path.join(CAMPAIGNS_ROOT, args.campaignId);
const campaign = readJson(path.join(campaignDir, "campaign.json"));
const iterDir = path.join(campaignDir, "iterations", String(args.iteration));

const deadSummary = loadLayerSummary(iterDir, "fallow-scan.json", summarizeDeadCode) ?? {};
const dupesSummary = loadLayerSummary(iterDir, "fallow-dupes.json", summarizeDupes);
const healthSummary = loadLayerSummary(iterDir, "fallow-health.json", summarizeHealth);

const classification = loadClassification(iterDir, args.campaignId, args.iteration);
const { verify, source: verifySource } = resolveVerify(iterDir);

const rawTotalIssues = deadSummary.total_issues ?? 0;
const actionableTotal =
  classification?.summary?.actionable_total ?? rawTotalIssues;
const falsePositiveTotal = classification?.summary?.false_positive_total ?? 0;
const reviewTotal = classification?.summary?.review_total ?? 0;

const { issues: rawBaselineIssues, source: baselineSource } = resolveFallowStartBaseline(
  campaignDir,
  campaign,
);
const actionableBaseline = resolveActionableBaseline(campaignDir);
const startActionable =
  actionableBaseline?.actionable_total ??
  (rawBaselineIssues != null && classification
    ? rawBaselineIssues - (actionableBaseline?.false_positive_total ?? 0)
    : rawBaselineIssues) ??
  actionableTotal;

const effectiveBaseline = startActionable ?? actionableTotal;

const dupesBaseline = readStartBaseline(campaignDir, "fallow-start-dupes-baseline.json", "clone_groups");
const healthBaseline = readStartBaseline(
  campaignDir,
  "fallow-start-health-baseline.json",
  "health_score",
);

const currentCloneGroups = dupesSummary?.clone_groups ?? null;
const currentHealthScore = healthSummary?.health_score ?? null;

const dupesStart =
  dupesBaseline.value ??
  readJson(path.join(iterDir, "iteration-baseline.json"), null)?.fallow_dupes_clone_groups ??
  currentCloneGroups;

const healthStart =
  healthBaseline.value ??
  readJson(path.join(iterDir, "iteration-baseline.json"), null)?.fallow_health_score ??
  currentHealthScore;

const skipWeightKeys = [];
if (dupesSummary == null || dupesStart == null || currentCloneGroups == null) {
  skipWeightKeys.push("fallow_dupes");
}
if (healthSummary == null || healthStart == null || currentHealthScore == null) {
  skipWeightKeys.push("fallow_health");
}
const effectiveWeights = normalizeWeights(WEIGHTS, skipWeightKeys);
const effectiveFallowWeight =
  (effectiveWeights.fallow_dead_code ?? 0) +
  (effectiveWeights.fallow_dupes ?? 0) +
  (effectiveWeights.fallow_health ?? 0);

const prevEntry = readJson(path.join(campaignDir, "satisfaction-history.yaml"), { entries: [] });
const prev = prevEntry.entries.filter((e) => e.iteration < args.iteration).pop();

const iterBaseline = readJson(path.join(iterDir, "iteration-baseline.json"), null);
const prevActionable = prev?.fallow_actionable_total ?? prev?.fallow_total_issues;
const iterationStartActionable =
  iterBaseline?.fallow_actionable_total ??
  iterBaseline?.fallow_total_issues ??
  prevActionable ??
  effectiveBaseline;

const deadCodeRate =
  effectiveBaseline > 0
    ? Math.max(0, (effectiveBaseline - actionableTotal) / effectiveBaseline)
    : 1;

const dupesRate =
  dupesSummary != null && dupesStart != null && currentCloneGroups != null
    ? (reductionRate(dupesStart, currentCloneGroups) ?? 0)
    : null;
const healthRate =
  healthSummary != null && healthStart != null && currentHealthScore != null
    ? (improvementRate(healthStart, currentHealthScore) ?? 0)
    : null;

const fallowCompositeRate =
  effectiveFallowWeight > 0
    ? ((deadCodeRate * (effectiveWeights.fallow_dead_code ?? 0)) +
        (dupesRate ?? 0) * (effectiveWeights.fallow_dupes ?? 0) +
        (healthRate ?? 0) * (effectiveWeights.fallow_health ?? 0)) /
      effectiveFallowWeight
    : deadCodeRate;

const iterationRate =
  iterationStartActionable > 0
    ? Math.max(0, (iterationStartActionable - actionableTotal) / iterationStartActionable)
    : deadCodeRate;

const structuralClean =
  (deadSummary.unresolved_imports ?? 0) === 0 && (deadSummary.circular_dependencies ?? 0) === 0;

const vitestPass = verify.vitest?.status === "pass";
const typecheckPass = verify.typecheck?.status === "pass";
const buildPass = verify.build?.status === "pass";
const goTestPass = verify.go_test?.status === "pass" || verify.go_test?.status === "skipped";
const e2ePass = verify.playwright?.status === "pass";

const components = {
  fallow_dead_code: scoreComponent(null, deadCodeRate),
  fallow_dupes: dupesRate == null ? null : scoreComponent(null, dupesRate),
  fallow_health: healthRate == null ? null : scoreComponent(null, healthRate),
  fallow_remediation: scoreComponent(null, fallowCompositeRate),
  structural_clean: scoreComponent(structuralClean),
  unit_tests: scoreComponent(vitestPass && typecheckPass),
  build: scoreComponent(buildPass),
  e2e: scoreComponent(e2ePass),
};

let score = 0;
for (const [key, weight] of Object.entries(effectiveWeights)) {
  score += (components[key] ?? 0) * weight * 100;
}
score = Math.round(score * 10) / 10;

const entry = {
  iteration: args.iteration,
  at: isoNow(),
  score,
  rate: Math.round(fallowCompositeRate * 1000) / 1000,
  dead_code_rate: Math.round(deadCodeRate * 1000) / 1000,
  dupes_rate: dupesRate == null ? null : Math.round(dupesRate * 1000) / 1000,
  health_rate: healthRate == null ? null : Math.round(healthRate * 1000) / 1000,
  iteration_rate: Math.round(iterationRate * 1000) / 1000,
  fallow_raw_total: rawTotalIssues,
  fallow_actionable_total: actionableTotal,
  fallow_false_positive_total: falsePositiveTotal,
  fallow_review_total: reviewTotal,
  fallow_dupes_clone_groups: currentCloneGroups,
  fallow_dupes_duplication_percentage: dupesSummary?.duplication_percentage ?? null,
  fallow_health_score: currentHealthScore,
  fallow_health_functions_above_threshold: healthSummary?.functions_above_threshold ?? null,
  fallow_start_baseline: effectiveBaseline,
  fallow_start_baseline_raw: rawBaselineIssues,
  fallow_dupes_start_baseline: dupesStart,
  fallow_health_start_baseline: healthStart,
  fallow_baseline_source: baselineSource,
  fallow_dupes_baseline_source: dupesBaseline.source,
  fallow_health_baseline_source: healthBaseline.source,
  fallow_scoring_mode: "actionable_dead_code_plus_dupes_health",
  delta_vs_baseline: actionableTotal - effectiveBaseline,
  delta_vs_baseline_raw: rawTotalIssues - (rawBaselineIssues ?? rawTotalIssues),
  delta_dupes_vs_baseline: currentCloneGroups - (dupesStart ?? currentCloneGroups),
  delta_health_vs_baseline:
    currentHealthScore != null && healthStart != null ? currentHealthScore - healthStart : null,
  delta_vs_iteration_start: actionableTotal - iterationStartActionable,
  delta_vs_previous: prev
    ? actionableTotal - (prev.fallow_actionable_total ?? prev.fallow_total_issues)
    : null,
  e2e_pass: e2ePass,
  vitest_pass: vitestPass,
  typecheck_pass: typecheckPass,
  build_pass: buildPass,
  go_test_pass: goTestPass,
  weights_applied: effectiveWeights,
  weights_skipped_layers: skipWeightKeys,
  components,
  classification_path: path.join(iterDir, "fallow-classification.json"),
  fallow_dupes_path: path.join(iterDir, "fallow-dupes.json"),
  fallow_health_path: path.join(iterDir, "fallow-health.json"),
  verify_path: path.join(
    iterDir,
    verifySource === "verify-debt.json" ? "verify-debt.json" : "verify-iteration.json",
  ),
  verify_source: verifySource,
  /** @deprecated use fallow_actionable_total */
  fallow_total_issues: actionableTotal,
};

writeJson(path.join(iterDir, "satisfaction.json"), entry);

const history = readJson(path.join(campaignDir, "satisfaction-history.yaml"), { entries: [] });
history.entries = history.entries.filter((e) => e.iteration !== args.iteration);
history.entries.push(entry);
history.entries.sort((a, b) => a.iteration - b.iteration);
writeJson(path.join(campaignDir, "satisfaction-history.yaml"), history);

if (campaign) {
  campaign.current = {
    fallow_total_issues: rawTotalIssues,
    fallow_actionable_total: actionableTotal,
    fallow_false_positive_total: falsePositiveTotal,
    fallow_dupes_clone_groups: currentCloneGroups,
    fallow_health_score: currentHealthScore,
    satisfaction_score: score,
    satisfaction_rate: entry.rate,
    e2e_pass: e2ePass,
    verify_status: verify.status ?? null,
  };
  campaign.updated_at = isoNow();
  const threshold = campaign.config?.satisfaction_threshold ?? 85;
  if (
    score >= threshold &&
    e2ePass &&
    vitestPass &&
    typecheckPass &&
    buildPass &&
    (verify.metrics?.total_errors ?? 0) === 0
  ) {
    campaign.status = "satisfied";
  }
  writeJson(path.join(campaignDir, "campaign.json"), campaign);
}

const journalLine = `- **Iteration ${args.iteration}** — satisfaction **${score}/100** (fallow composite ${(entry.rate * 100).toFixed(1)}%: dead-code ${(deadCodeRate * 100).toFixed(1)}%${dupesRate != null ? `, dupes ${(dupesRate * 100).toFixed(1)}%` : ""}${healthRate != null ? `, health ${(healthRate * 100).toFixed(1)}%` : ""}), fallow raw=${rawTotalIssues} actionable=${actionableTotal} (FP=${falsePositiveTotal})${currentCloneGroups != null ? `, dupes=${currentCloneGroups} groups` : ""}${currentHealthScore != null ? `, health=${currentHealthScore}` : ""}, E2E ${e2ePass ? "PASS" : "FAIL"}\n`;
fs.appendFileSync(path.join(campaignDir, "journal.md"), `\n### ${entry.at}\n${journalLine}`);

console.log(JSON.stringify({ ok: true, satisfaction: entry, satisfied: campaign?.status === "satisfied" }));
