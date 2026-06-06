#!/usr/bin/env node
/**
 * Capability evidence loop — resolve capabilities, extract run evidence,
 * aggregate cross-run stats, evaluate deterministic lifecycle state.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  AAAC_ROOT,
  STATE_ROOT,
  readJson,
  writeJson,
  runDir,
  loadRunManifest,
  isoNow,
} from "./lib.mjs";

export const ONTOLOGY_PATH = path.join(AAAC_ROOT, "ontology.json");
export const CAPABILITY_REGISTRY_PATH = path.join(AAAC_ROOT, "capabilities", "registry.json");
export const PROMOTION_RULES_PATH = path.join(AAAC_ROOT, "capabilities", "promotion-rules.json");
export const CAPABILITY_STATS_PATH = path.join(STATE_ROOT, "capability-stats.json");

const STATE_ORDER = ["experimental", "validated", "trusted", "canonical", "deprecated"];

export function loadOntology() {
  return readJson(ONTOLOGY_PATH, { object_capabilities: {}, object_capability_verbs: {} });
}

export function loadCapabilityRegistry() {
  return readJson(CAPABILITY_REGISTRY_PATH, { capabilities: {} });
}

export function loadPromotionRules() {
  return readJson(PROMOTION_RULES_PATH, {
    default_state: "experimental",
    thresholds: {},
    demotion: {},
    fitness_scoring: { pass: 100, warning: 75, fail: 0 },
  });
}

export function loadCapabilityStats() {
  return readJson(CAPABILITY_STATS_PATH, {
    version: 1,
    updated_at: null,
    capabilities: {},
  });
}

export function saveCapabilityStats(stats) {
  stats.updated_at = isoNow();
  writeJson(CAPABILITY_STATS_PATH, stats);
}

export function capabilityIdsForObject(object, verb, ontology = loadOntology()) {
  if (!object) return [];
  const base = ontology.object_capabilities?.[object] ?? [];
  const verbExtras = ontology.object_capability_verbs?.[object]?.[verb] ?? [];
  return [...new Set([...base, ...verbExtras])];
}

export function loadObjectMaturity(object) {
  if (!object) return "evolving";
  const ontology = loadOntology();
  return ontology.object_maturity?.[object] ?? "evolving";
}

export function resolveCapabilitiesForObject(object, verb) {
  const ontology = loadOntology();
  const registry = loadCapabilityRegistry();
  const ids = capabilityIdsForObject(object, verb, ontology);
  const resolved = {};

  for (const capabilityId of ids) {
    const entry = registry.capabilities?.[capabilityId];
    resolved[capabilityId] = {
      providers: entry?.providers ?? [],
      source: `object ${object}${verb ? ` verb ${verb}` : ""}`,
    };
  }

  return resolved;
}

export function resolveCapabilitiesWithRuntime(object, verb) {
  const resolved = resolveCapabilitiesForObject(object, verb);
  const store = loadCapabilityStats();
  const rules = loadPromotionRules();
  const defaultState = rules.default_state ?? "experimental";

  for (const [capabilityId, resolution] of Object.entries(resolved)) {
    const entry = store.capabilities[capabilityId];
    const state = entry?.state ?? defaultState;
    const rates = entry ? computeRates(entry.stats) : null;
    resolved[capabilityId] = {
      ...resolution,
      runtime: {
        state,
        invocations: entry?.stats?.invocations ?? 0,
        success_rate: rates?.success_rate ?? null,
        avg_fitness: rates?.avg_fitness ?? null,
      },
    };
  }

  return resolved;
}

export function evaluateCapabilityRuntimePolicy(resolved, context = {}) {
  const rules = loadPromotionRules();
  const runtime = rules.runtime ?? {};
  const byState = runtime.by_state ?? {};
  const evidenceTriggers = runtime.evidence_triggers ?? [];
  const objectMaturity = context.object_maturity ?? "evolving";

  const reasons = [];
  let action = "allow";

  const rank = { allow: 0, warn: 1, require_approval: 2, block: 3 };
  const raise = (next, reason) => {
    if (rank[next] > rank[action]) action = next;
    reasons.push(reason);
  };

  for (const [capabilityId, resolution] of Object.entries(resolved)) {
    const state = resolution.runtime?.state ?? rules.default_state ?? "experimental";
    const statePolicy = byState[state] ?? {};

    if (statePolicy.block_execute) {
      raise("block", `${capabilityId}: state ${state} blocks execute`);
    }

    const requireOn = statePolicy.require_approval_on ?? [];
    if (requireOn.includes(objectMaturity) || requireOn.includes("all")) {
      raise(
        "require_approval",
        `${capabilityId}: ${state} on ${objectMaturity} object requires approval`,
      );
    }

    if (statePolicy.warn) {
      raise("warn", `${capabilityId}: ${state} — proceed with caution`);
    }

    const invocations = resolution.runtime?.invocations ?? 0;
    const successRate = resolution.runtime?.success_rate;
    const avgFitness = resolution.runtime?.avg_fitness;

    for (const trigger of evidenceTriggers) {
      if (invocations < (trigger.min_invocations ?? 0)) continue;

      if (
        successRate != null &&
        trigger.min_success_rate_below != null &&
        successRate < trigger.min_success_rate_below
      ) {
        raise(
          trigger.action === "block" ? "block" : "require_approval",
          `${capabilityId}: success_rate ${(successRate * 100).toFixed(1)}% below threshold`,
        );
      }

      if (
        avgFitness != null &&
        trigger.min_avg_fitness_below != null &&
        avgFitness < trigger.min_avg_fitness_below
      ) {
        raise(
          trigger.action === "block" ? "block" : "require_approval",
          `${capabilityId}: avg_fitness ${avgFitness.toFixed(1)} below threshold`,
        );
      }
    }
  }

  return { action, reasons, object_maturity: objectMaturity };
}

function parseSimpleYaml(content) {
  const result = {};
  let currentKey = null;
  let currentIndent = 0;

  for (const line of content.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    if (trimmed.endsWith(":") && !trimmed.includes(": ")) {
      currentKey = trimmed.slice(0, -1);
      currentIndent = indent;
      result[currentKey] = {};
      continue;
    }

    const colon = trimmed.indexOf(": ");
    if (colon === -1) continue;

    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 2).trim().replace(/^["']|["']$/g, "");

    if (currentKey && indent > currentIndent) {
      result[currentKey][key] = value;
    } else {
      result[key] = value;
      currentKey = null;
    }
  }

  return result;
}

function fitnessScoreFromArtifact(artifactsDir, scoring) {
  const fitnessPath = path.join(artifactsDir, "fitness-functions.yaml");
  if (!fs.existsSync(fitnessPath)) return null;

  const content = fs.readFileSync(fitnessPath, "utf8");
  const scores = [];
  const scoreSection = content.match(/^score:\n([\s\S]*?)(?:\n\w|$)/m);
  if (!scoreSection) return null;

  for (const line of scoreSection[1].split("\n")) {
    const match = line.match(/^\s+(\w+):\s+(pass|warning|fail)/);
    if (match) {
      scores.push(scoring[match[2]] ?? 0);
    }
  }

  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export function extractRunEvidence(manifest, artifactsDir) {
  const log = manifest.log ?? [];
  const gateFails = log.filter((e) => e.event === "gate_fail").length;
  const gatePasses = log.filter((e) => e.event === "gate_pass").length;
  const rules = loadPromotionRules();
  const fitnessScore = fitnessScoreFromArtifact(artifactsDir, rules.fitness_scoring ?? {});

  const success = manifest.status === "completed";
  const failure = manifest.status === "failed";

  return {
    success,
    failure,
    rollback: failure,
    gate_failures: gateFails,
    gate_passes: gatePasses,
    fitness_score: fitnessScore,
    run_id: manifest.run_id,
    command: manifest.command,
    object: manifest.object,
    verb: manifest.verb,
  };
}

function emptyCapabilityEntry(state = "experimental") {
  return {
    state,
    stats: {
      invocations: 0,
      successes: 0,
      failures: 0,
      rollbacks: 0,
      gate_passes: 0,
      gate_failures: 0,
      avg_fitness_score: null,
      fitness_samples: 0,
    },
    gate_history: { passed: 0, failed: 0 },
    history: { promoted: [] },
    overrides: null,
    last_run_id: null,
  };
}

export function computeRates(stats) {
  const invocations = stats.invocations || 0;
  if (!invocations) {
    return {
      success_rate: 0,
      rollback_rate: 0,
      gate_failure_rate: 0,
      avg_fitness: stats.avg_fitness_score,
    };
  }

  return {
    success_rate: stats.successes / invocations,
    rollback_rate: stats.rollbacks / invocations,
    gate_failure_rate: stats.gate_failures / (stats.gate_passes + stats.gate_failures || 1),
    avg_fitness: stats.avg_fitness_score,
  };
}

function meetsThreshold(stats, rates, threshold) {
  if (threshold.min_invocations != null && stats.invocations < threshold.min_invocations) {
    return false;
  }
  if (threshold.min_success_rate != null && rates.success_rate < threshold.min_success_rate) {
    return false;
  }
  if (threshold.max_rollback_rate != null && rates.rollback_rate > threshold.max_rollback_rate) {
    return false;
  }
  if (
    threshold.max_gate_failure_rate != null &&
    rates.gate_failure_rate > threshold.max_gate_failure_rate
  ) {
    return false;
  }
  return true;
}

export function evaluateState(entry, rules = loadPromotionRules()) {
  if (entry.overrides?.state) return entry.overrides.state;

  const rates = computeRates(entry.stats);
  const thresholds = rules.thresholds ?? {};
  const demotion = rules.demotion?.from_trusted;

  if (
    entry.state === "trusted" &&
    demotion &&
    entry.stats.invocations >= (demotion.min_invocations ?? 0) &&
    rates.success_rate < (demotion.min_success_rate_below ?? 0)
  ) {
    return "validated";
  }

  const candidates = ["canonical", "trusted", "validated"];
  for (const state of candidates) {
    const threshold = thresholds[state];
    if (!threshold) continue;
    if (threshold.manual_approval && !entry.overrides?.approved_by) continue;
    if (meetsThreshold(entry.stats, rates, threshold)) return state;
  }

  return rules.default_state ?? "experimental";
}

export function updateCapabilityFromEvidence(store, capabilityId, evidence) {
  const entry = store.capabilities[capabilityId] ?? emptyCapabilityEntry();
  const stats = entry.stats;

  stats.invocations += 1;
  if (evidence.success) stats.successes += 1;
  if (evidence.failure) stats.failures += 1;
  if (evidence.rollback) stats.rollbacks += 1;
  stats.gate_passes += evidence.gate_passes;
  stats.gate_failures += evidence.gate_failures;
  entry.gate_history.passed += evidence.gate_passes;
  entry.gate_history.failed += evidence.gate_failures;

  if (evidence.fitness_score != null) {
    const n = stats.fitness_samples;
    stats.avg_fitness_score =
      stats.avg_fitness_score == null
        ? evidence.fitness_score
        : (stats.avg_fitness_score * n + evidence.fitness_score) / (n + 1);
    stats.fitness_samples = n + 1;
  }

  const previousState = entry.state;
  const rules = loadPromotionRules();
  entry.state = evaluateState(entry, rules);
  if (entry.state !== previousState && !entry.history.promoted.includes(entry.state)) {
    entry.history.promoted.push(entry.state);
  }

  entry.last_run_id = evidence.run_id;
  store.capabilities[capabilityId] = entry;
  return { previousState, newState: entry.state, entry };
}

export function processRunEvidence(runId, options = {}) {
  const manifest = options.manifest ?? loadRunManifest(runId);
  if (!manifest) {
    return { ok: false, error: `Run not found: ${runId}` };
  }

  if (manifest.capability_evidence_processed && !options.force) {
    return { ok: true, skipped: true, reason: "already_processed" };
  }

  const artifactsDir = path.join(runDir(runId), "artifacts");
  const evidence = extractRunEvidence(manifest, artifactsDir);

  const resolved =
    manifest.capabilities_resolved &&
    Object.keys(manifest.capabilities_resolved).length > 0
      ? manifest.capabilities_resolved
      : resolveCapabilitiesForObject(manifest.object, manifest.verb);

  const capabilityIds = Object.keys(resolved);
  if (!capabilityIds.length) {
    return { ok: true, skipped: true, reason: "no_capabilities" };
  }

  const store = loadCapabilityStats();
  const outcomes = [];

  for (const capabilityId of capabilityIds) {
    const result = updateCapabilityFromEvidence(store, capabilityId, evidence);
    outcomes.push({
      capability_id: capabilityId,
      previous_state: result.previousState,
      new_state: result.newState,
      stats: result.entry.stats,
    });
  }

  saveCapabilityStats(store);

  const result = {
    ok: true,
    run_id: runId,
    outcomes,
    capabilities: capabilityIds,
    resolved,
    evidence,
  };

  if (!options.skipManifestWrite) {
    manifest.capability_evidence_processed = true;
    manifest.capability_evidence_outcomes = outcomes;
    if (!manifest.capabilities_resolved || !Object.keys(manifest.capabilities_resolved).length) {
      manifest.capabilities_resolved = resolved;
    }
    manifest.updated_at = isoNow();
    writeJson(path.join(runDir(runId), "run.json"), manifest);
  }

  return result;
}

function main() {
  const args = process.argv.slice(2);
  const runIdIdx = args.indexOf("--run-id");
  const runId = runIdIdx >= 0 ? args[runIdIdx + 1] : args[0];
  const force = args.includes("--force");

  if (!runId) {
    console.error("Usage: capability-evidence.mjs --run-id <run_id> [--force]");
    process.exit(1);
  }

  const result = processRunEvidence(runId, { force });
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
