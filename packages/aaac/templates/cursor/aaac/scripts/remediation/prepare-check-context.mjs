#!/usr/bin/env node
/**
 * Build readonly check_swarm context from Fallow scan + classification.
 *
 * Usage:
 *   node prepare-check-context.mjs --campaign-id <id> --iteration <n> [--run-id <run_id>]
 */
import fs from "fs";
import path from "path";
import { REPO_ROOT, isoNow, readJson, writeJson, runDir } from "../run-engine/lib.mjs";
import {
  summarizeDeadCode,
  summarizeDupes,
  summarizeHealth,
} from "./lib/fallow-metrics.mjs";
import { loadContextBudget } from "../run-engine/context-budget.mjs";

const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");
const FRONTEND_ROOT = path.join(REPO_ROOT, "frontend");

function parseArgs(argv) {
  const out = { campaignId: null, iteration: 0, runId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--run-id") out.runId = argv[++i];
  }
  return out;
}

function loadLayer(iterDir, file, summarize) {
  const p = path.join(iterDir, file);
  if (!fs.existsSync(p)) return null;
  const payload = readJson(p, {});
  return payload._remediation?.summary ?? summarize(payload);
}

function topCloneGroups(dupesPayload, limit) {
  const budget = loadContextBudget();
  const cap = limit ?? budget.compaction.dupes_top_groups;
  const groups = dupesPayload?.clone_groups;
  if (!Array.isArray(groups)) return [];
  return [...groups]
    .sort((a, b) => (b.token_count ?? 0) - (a.token_count ?? 0))
    .slice(0, cap)
    .map((g) => ({
      token_count: g.token_count,
      line_count: g.line_count,
      instances: (g.instances ?? []).map((i) => ({
        file: i.file,
        start_line: i.start_line,
        end_line: i.end_line,
      })),
    }));
}

function inventoryByClassification(classification) {
  const buckets = { true_positive: [], review: [], false_positive: [] };
  for (const item of classification?.inventory ?? []) {
    const bucket = buckets[item.classification] ?? buckets.review;
    bucket.push({
      id: item.id,
      category: item.category,
      path: item.path,
      export_name: item.export_name,
      reason: item.reason,
      rule_id: item.rule_id,
    });
  }
  return buckets;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("prepare-check-context: --campaign-id required");
  process.exit(2);
}

const campaignDir = path.join(CAMPAIGNS_ROOT, args.campaignId);
const iterDir = path.join(campaignDir, "iterations", String(args.iteration));
const campaign = readJson(path.join(campaignDir, "campaign.json"), {});

const deadScan = readJson(path.join(iterDir, "fallow-scan.json"), null);
const dupesScan = readJson(path.join(iterDir, "fallow-dupes.json"), null);
const healthScan = readJson(path.join(iterDir, "fallow-health.json"), null);
const classification = readJson(path.join(iterDir, "fallow-classification.json"), null);
const registry = readJson(path.join(campaignDir, "fallow-false-positives.json"), { entries: [] });

if (!deadScan) {
  console.error("prepare-check-context: fallow-scan.json missing — run fallow-scan.mjs first");
  process.exit(2);
}

const inventory = inventoryByClassification(classification);
const budget = loadContextBudget();
const context = {
  prepared_at: isoNow(),
  campaign_id: args.campaignId,
  iteration: args.iteration,
  scope: campaign.scope ?? "whole-repo",
  root: FRONTEND_ROOT,
  questions: {
    check_app:
      "Which Fallow unused files, exports, and class members are live runtime surfaces (workers, hooks, barrels, lazy routes, provider interfaces) and must NOT be deleted?",
    check_architecture:
      "Which dead-code removals or dupes consolidations would break layer boundaries, SSOT, import graphs, or main/worker pairs?",
  },
  fallow: {
    dead_code: loadLayer(iterDir, "fallow-scan.json", summarizeDeadCode),
    dupes: loadLayer(iterDir, "fallow-dupes.json", summarizeDupes),
    health: loadLayer(iterDir, "fallow-health.json", summarizeHealth),
    classification_summary: classification?.summary ?? null,
    inventory,
    top_review_for_trace: inventory.review.slice(0, budget.compaction.top_review_for_trace),
    top_actionable: inventory.true_positive.slice(0, budget.compaction.top_actionable),
  },
  dupes_top_groups: topCloneGroups(dupesScan),
  registry_entry_count: registry.entries?.length ?? 0,
  registry_paths: (registry.entries ?? []).map((e) => e.path),
  trace_commands: {
    trace_file: "fallow dead-code --format json --quiet --trace-file <path>",
    trace_export: "fallow dead-code --format json --quiet --trace <path>:<export>",
    trace_clone: "fallow dupes --format json --quiet --trace <path>:<line>",
  },
  agent_specs: {
    check_app: [
      ".cursor/agents/remediation-check-app-inventory.md",
      ".cursor/agents/remediation-check-app-ssot.md",
      ".cursor/agents/remediation-check-app-trace.md",
    ],
    check_architecture: [
      ".cursor/agents/remediation-check-architecture-boundaries.md",
      ".cursor/agents/remediation-check-architecture-deps.md",
      ".cursor/agents/remediation-check-architecture-decomposition.md",
    ],
    check_risk: ".cursor/agents/remediation-check-risk.md",
  },
  merge_script:
    "node .cursor/aaac/scripts/remediation/merge-check-swarm.mjs --campaign-id <id> --iteration <n>",
  record_fp_script:
    "node .cursor/aaac/scripts/remediation/record-fallow-fp.mjs --campaign-id <id> --from-json <file>",
};

const outPath = path.join(iterDir, "check-context.json");
writeJson(outPath, context);

if (args.runId) {
  writeJson(path.join(runDir(args.runId), "artifacts", "check_context.json"), context);
}

console.log(JSON.stringify({ ok: true, path: outPath, actionable: inventory.true_positive.length, review: inventory.review.length }));
