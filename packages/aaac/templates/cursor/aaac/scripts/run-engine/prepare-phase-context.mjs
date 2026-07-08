#!/usr/bin/env node
/**
 * Build compact phase context for swarm agents from a Run manifest.
 *
 * Usage:
 *   node prepare-phase-context.mjs --run-id <run_id>
 */
import path from "path";
import { isoNow, loadRunManifest, runDir, writeJson } from "./lib.mjs";
import { loadContextBudget } from "./context-budget.mjs";
import { resolveModelForPhase } from "./resolve-model-for-phase.mjs";

function parseArgs(argv) {
  const out = { runId: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run-id") out.runId = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.runId) {
  console.error("prepare-phase-context: --run-id required");
  process.exit(2);
}

const manifest = loadRunManifest(args.runId);
if (!manifest) {
  console.error(`prepare-phase-context: Run not found: ${args.runId}`);
  process.exit(1);
}

const budget = loadContextBudget();
const intent =
  typeof manifest.intent === "string" ? manifest.intent.slice(0, 2000) : "";
const modelRouting = resolveModelForPhase({ phase: manifest.phase });

const context = {
  prepared_at: isoNow(),
  run_id: args.runId,
  command: manifest.command,
  verb: manifest.verb,
  object: manifest.object ?? null,
  domain: manifest.domain ?? null,
  intent,
  phase: manifest.phase,
  completed: manifest.completed ?? [],
  complexity: {
    scope_score: manifest.complexity?.scope_score ?? null,
    change_score: manifest.complexity?.change_score ?? null,
  },
  swarm_target: manifest.swarm?.target_agents?.[manifest.phase] ?? null,
  wave_plan: manifest.swarm?.wave_plan?.[manifest.phase] ?? null,
  model_routing: {
    tier: modelRouting.tier ?? null,
    model_slug: modelRouting.model_slug ?? null,
    source: modelRouting.source ?? null,
    parent_only: modelRouting.parent_only ?? false,
  },
  compaction: budget.compaction,
  handoff: {
    rule: "artifact_first",
    discover_brief: budget.handoff.check_discover,
    phase_context: "artifacts/phase_context.json",
  },
  policy_paths: {
    context_budget: ".cursor/aaac/context-budget.yaml",
    swarm_sizing: ".cursor/aaac/swarm-sizing.yaml",
    model_routing: ".cursor/aaac/model-routing.yaml",
    context_budget_policy: ".cursor/policies/context-budget.md",
    model_routing_policy: ".cursor/policies/model-routing.md",
    task_prompt_policy: ".cursor/skills/shared/_task-prompt-policy.md",
  },
  instructions:
    "Read this file only — do not load full prior swarm transcripts. Return structured blocks per agent spec.",
};

const outPath = path.join(runDir(args.runId), "artifacts", "phase_context.json");
writeJson(outPath, context);

console.log(
  JSON.stringify({
    ok: true,
    path: outPath,
    verb: manifest.verb,
    phase: manifest.phase,
  }),
);
