#!/usr/bin/env node
/**
 * Load swarm-sizing.yaml SSOT with enforcement.json fallback for floors.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function aaacRoot() {
  const workspaceOverride = process.env.AAAC_WORKSPACE_ROOT;
  if (workspaceOverride) {
    return path.join(path.resolve(workspaceOverride), ".cursor", "aaac");
  }
  const fromPackage = path.resolve(__dirname, "../../../..", ".cursor", "aaac");
  if (fs.existsSync(path.join(fromPackage, "swarm-sizing.yaml"))) {
    return fromPackage;
  }
  return path.resolve(__dirname, "../../..", "aaac");
}

const SWARM_SIZING_PATH = path.join(aaacRoot(), "swarm-sizing.yaml");

let cachedSizing = null;

function loadYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8");
  try {
    const require = createRequire(import.meta.url);
    const pkgRoot = path.resolve(__dirname, "../..");
    const yaml = require(require.resolve("yaml", { paths: [pkgRoot] }));
    return yaml.parse(content);
  } catch {
    return null;
  }
}

function loadComplexityYaml() {
  const complexityPath = path.join(aaacRoot(), "complexity.yaml");
  return loadYamlFile(complexityPath) ?? {};
}

/** @param {object} enforcement */
export function loadSwarmSizing(enforcement = {}) {
  if (cachedSizing) return cachedSizing;

  const parsed = loadYamlFile(SWARM_SIZING_PATH);
  const fallbackFloors = enforcement.swarm_min_agents ?? {};

  if (!parsed) {
    cachedSizing = {
      version: 1,
      phase_classes: {
        scope_driven: [
          "discover",
          "investigate_lite",
          "investigate_swarm",
          "research_swarm",
          "check_swarm",
        ],
        change_driven: [
          "validate",
          "impact_analysis",
          "dependency_graph",
          "fitness_functions",
          "rollback",
          "verify",
          "review_swarm",
          "report",
        ],
        fixed: ["plan", "execute", "test_execute", "write", "parse", "persist"],
      },
      floors: { ...fallbackFloors },
      ceilings: {},
      command_overrides: enforcement.swarm_min_agents_by_command ?? {},
      bootstrap: { weights: {} },
      scope_weights: {},
      change_weights: {},
      scope_tiers: {},
      change_tiers: {},
      complexity: loadComplexityYaml(),
    };
    return cachedSizing;
  }

  cachedSizing = {
    ...parsed,
    floors: { ...fallbackFloors, ...(parsed.floors ?? {}) },
    ceilings: parsed.ceilings ?? {},
    command_overrides: {
      ...(enforcement.swarm_min_agents_by_command ?? {}),
      ...(parsed.command_overrides ?? {}),
    },
    complexity: loadComplexityYaml(),
  };
  return cachedSizing;
}

export function resetSwarmSizingCache() {
  cachedSizing = null;
}

export function getPhaseClass(phase, sizing) {
  if (sizing.phase_classes?.fixed?.includes(phase)) return "fixed";
  if (sizing.phase_classes?.scope_driven?.includes(phase)) return "scope_driven";
  if (sizing.phase_classes?.change_driven?.includes(phase)) return "change_driven";
  return "fixed";
}

/** Pick agent count from ordered tier list for a score. */
export function tierLookup(tiers, score) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const numericScore = Number(score) || 0;
  for (const tier of tiers) {
    if (numericScore <= (tier.max ?? 999)) {
      return tier.agents ?? null;
    }
  }
  return tiers[tiers.length - 1]?.agents ?? null;
}

export function resolveSwarmFloor(phase, manifest, sizing) {
  const commandOverride =
    sizing.command_overrides?.[manifest.command]?.[phase] ??
    sizing.command_overrides?.[manifest.command];
  if (typeof commandOverride === "number") return commandOverride;

  if (phase === "discover" && manifest.verb === "check") {
    return sizing.floors.check_swarm ?? sizing.floors.discover ?? 3;
  }

  return sizing.floors[phase] ?? 1;
}

export function resolveSwarmCeiling(phase, sizing) {
  return sizing.ceilings[phase] ?? sizing.ceilings.default ?? 99;
}

export { SWARM_SIZING_PATH };
