#!/usr/bin/env node
/**
 * Merge remediation check_swarm agent outputs → FP registry, reclassify, guardrail artifacts.
 *
 * Usage:
 *   node merge-check-swarm.mjs --campaign-id <id> --iteration <n> [--run-id <run_id>]
 *
 * Reads iterations/{n}/check-swarm-raw.json (parent-collected agent JSON blocks).
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { REPO_ROOT, isoNow, readJson, writeJson, runDir } from "../run-engine/lib.mjs";
import { loadContextBudget, capList } from "../run-engine/context-budget.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

function parseArgs(argv) {
  const out = { campaignId: null, iteration: 0, runId: null, rawPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--raw") out.rawPath = argv[++i];
  }
  return out;
}

function normalizePath(p) {
  return (p ?? "").replace(/^frontend\//, "").replace(/^\//, "");
}

function uniqByPath(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${normalizePath(item.path)}:${item.export_name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, path: normalizePath(item.path) });
  }
  return out;
}

function yamlList(items, indent = 2) {
  const pad = " ".repeat(indent);
  if (!items.length) return `${pad}[]\n`;
  return items.map((i) => `${pad}- ${JSON.stringify(i)}`).join("\n") + "\n";
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("merge-check-swarm: --campaign-id required");
  process.exit(2);
}

const campaignDir = path.join(CAMPAIGNS_ROOT, args.campaignId);
const iterDir = path.join(campaignDir, "iterations", String(args.iteration));
const rawPath =
  args.rawPath ?? path.join(iterDir, "check-swarm-raw.json");

if (!fs.existsSync(rawPath)) {
  console.error(`merge-check-swarm: missing ${rawPath}`);
  process.exit(2);
}

const raw = readJson(rawPath, { agents: [] });
const agents = Array.isArray(raw.agents) ? raw.agents : Array.isArray(raw) ? raw : [];

const falsePositives = [];
const protectedPaths = [];
const doNotDelete = [];
const safeToFix = [];
const findings = [];
const gaps = [];

for (const agent of agents) {
  for (const fp of agent.false_positives ?? []) {
    falsePositives.push({
      ...fp,
      source: agent.agent_id ?? agent.command_mirror ?? "check-swarm",
      iteration: args.iteration,
    });
  }
  for (const p of agent.protected_paths ?? []) {
    protectedPaths.push(normalizePath(p));
  }
  for (const d of agent.do_not_delete ?? []) {
    doNotDelete.push({ path: normalizePath(d.path ?? d), reason: d.reason ?? "protected" });
  }
  for (const s of agent.safe_to_fix ?? []) {
    safeToFix.push({
      path: normalizePath(s.path),
      category: s.category ?? null,
      export_name: s.export_name ?? null,
      evidence: s.evidence ?? null,
    });
  }
  if (Array.isArray(agent.findings)) findings.push(...agent.findings.map((f) => `[${agent.agent_id}] ${f}`));
  if (Array.isArray(agent.gaps)) gaps.push(...agent.gaps.map((g) => `[${agent.agent_id}] ${g}`));
}

const budget = loadContextBudget();
const findingsRaw = findings.length;
const gapsRaw = gaps.length;
const findingsCapped = capList(findings, budget.compaction.merge_findings_max);
const gapsCapped = capList(gaps, budget.compaction.merge_gaps_max);
const compactionApplied = findingsCapped.length < findingsRaw || gapsCapped.length < gapsRaw;

const fpDeduped = uniqByPath(falsePositives);
const protectedDeduped = [...new Set(protectedPaths)];
const doNotDeleteDeduped = uniqByPath(
  doNotDelete.map((d) => ({ path: d.path, export_name: null, reason: d.reason })),
);

if (fpDeduped.length) {
  const batchPath = path.join(iterDir, "check-swarm-fp-batch.json");
  writeJson(batchPath, { entries: fpDeduped });
  spawnSync(
    process.execPath,
    [
      path.join(__dirname, "record-fallow-fp.mjs"),
      "--campaign-id",
      args.campaignId,
      "--from-json",
      batchPath,
    ],
    { encoding: "utf8" },
  );
}

spawnSync(
  process.execPath,
  [
    path.join(__dirname, "classify-fallow-issues.mjs"),
    "--campaign-id",
    args.campaignId,
    "--iteration",
    String(args.iteration),
  ],
  { encoding: "utf8" },
);

const classification = readJson(path.join(iterDir, "fallow-classification.json"), {});
const context = readJson(path.join(iterDir, "check-context.json"), {});

const merge = {
  merged_at: isoNow(),
  campaign_id: args.campaignId,
  iteration: args.iteration,
  agents_reported: agents.length,
  false_positives_recorded: fpDeduped.length,
  protected_paths: protectedDeduped,
  do_not_delete: doNotDeleteDeduped,
  safe_to_fix: safeToFix,
  classification_after_merge: classification.summary ?? null,
  findings: findingsCapped,
  gaps: gapsCapped,
  context_telemetry: {
    artifact_bytes: null,
    compaction_applied: compactionApplied,
    findings_raw: findingsRaw,
    findings_kept: findingsCapped.length,
    gaps_raw: gapsRaw,
    gaps_kept: gapsCapped.length,
  },
};

writeJson(path.join(iterDir, "check-swarm-merge.json"), merge);

const checkAppAgents = agents.filter((a) => a.command_mirror === "check-app" || (a.agent_id ?? "").includes("check-app"));
const archAgents = agents.filter(
  (a) => a.command_mirror === "check-architecture" || (a.agent_id ?? "").includes("check-architecture"),
);

const checkAppValidate = {
  run_id: args.runId ?? null,
  phase: "validate",
  command: "check-app",
  command_mirror: true,
  campaign_id: args.campaignId,
  iteration: args.iteration,
  intent: context.questions?.check_app ?? "Fallow false-positive triage for app runtime surfaces",
  answer: checkAppAgents.some((a) => a.answer === "partial")
    ? "partial"
    : checkAppAgents.every((a) => a.answer === "yes")
      ? "yes"
      : "partial",
  confidence: {
    overall: checkAppAgents.length >= 3 ? 0.85 : 0.6,
  },
  requirements_met: [
    "Traced Fallow review/actionable paths against app entry points and workers",
    `Recorded ${fpDeduped.length} false-positive paths for satisfaction scoring`,
    `Protected ${protectedDeduped.length} paths from wave deletion`,
  ],
  requirements_not_met: gapsCapped.filter((g) => g.includes("check-app")),
  protected_paths: protectedDeduped,
  safe_to_fix_count: safeToFix.length,
};

const checkArchFitness = {
  run_id: args.runId ?? null,
  phase: "fitness_functions",
  command: "check-architecture",
  command_mirror: true,
  campaign_id: args.campaignId,
  iteration: args.iteration,
  intent: context.questions?.check_architecture ?? "Fallow deletion impact on architecture",
  answer: archAgents.some((a) => a.answer === "no") ? "no" : "partial",
  criteria: [
    "No wave may delete protected_paths or false_positive registry entries",
    "Dupes consolidation must preserve main/worker SSOT pairs until shared extract exists",
    "Boundary violations are fix targets; barrel facades default to review not delete",
  ],
  violations: findingsCapped.filter((f) => f.includes("boundary") || f.includes("check-architecture")),
  protected_paths: protectedDeduped,
};

const protectedYaml = {
  campaign_id: args.campaignId,
  iteration: args.iteration,
  updated_at: isoNow(),
  protected_paths: protectedDeduped,
  do_not_delete: doNotDeleteDeduped.map((d) => d.path),
  false_positive_paths: fpDeduped.map((f) => f.path),
  wave_exclude_block: protectedDeduped,
};

function writeArtifact(runId, name, data) {
  if (!runId) return;
  const dir = path.join(runDir(runId), "artifacts");
  fs.mkdirSync(dir, { recursive: true });
  const ext = name.endsWith(".yaml") ? ".yaml" : ".json";
  if (ext === ".json") {
    writeJson(path.join(dir, name), data);
    return;
  }
  const yaml = `campaign_id: ${args.campaignId}\niteration: ${args.iteration}\nupdated_at: ${isoNow()}\n\nprotected_paths:\n${protectedDeduped.map((p) => `  - ${p}`).join("\n") || "  []"}\n\ndo_not_delete:\n${doNotDeleteDeduped.map((d) => `  - path: ${d.path}\n    reason: ${JSON.stringify(d.reason)}`).join("\n") || "  []"}\n`;
  fs.writeFileSync(path.join(dir, name), yaml);
}

writeJson(path.join(iterDir, "protected-paths.json"), protectedYaml);
writeJson(path.join(iterDir, "check-app-validate.json"), checkAppValidate);
writeJson(path.join(iterDir, "check-architecture-fitness.json"), checkArchFitness);

if (args.runId) {
  const artDir = path.join(runDir(args.runId), "artifacts");
  fs.mkdirSync(artDir, { recursive: true });
  writeJson(path.join(artDir, "check_app_validate.yaml"), checkAppValidate);
  writeJson(path.join(artDir, "check_architecture_fitness.yaml"), checkArchFitness);
  writeJson(path.join(artDir, "check_swarm_merge.json"), merge);
  const yaml = `campaign_id: ${args.campaignId}\niteration: ${args.iteration}\nupdated_at: ${isoNow()}\n\nprotected_paths:\n${protectedDeduped.map((p) => `  - ${p}`).join("\n") || "  []"}\n\ndo_not_delete:\n${doNotDeleteDeduped.map((d) => `  - path: ${d.path}\n    reason: ${JSON.stringify(d.reason)}`).join("\n") || "  []"}\n`;
  fs.writeFileSync(path.join(artDir, "protected_paths.yaml"), yaml);
}

fs.appendFileSync(
  path.join(campaignDir, "journal.md"),
  `\n- **Check swarm merged** iter ${args.iteration}: agents=${agents.length}, fp_recorded=${fpDeduped.length}, protected=${protectedDeduped.length}, actionable_after=${classification.summary?.actionable_total ?? "?"}\n`,
);

console.log(
  JSON.stringify({
    ok: true,
    merge_path: path.join(iterDir, "check-swarm-merge.json"),
    false_positives_recorded: fpDeduped.length,
    protected_paths: protectedDeduped.length,
    actionable_total: classification.summary?.actionable_total,
  }),
);
