#!/usr/bin/env node
/**
 * Load model-routing.yaml SSOT (cached) with safe defaults.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOG_LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function normalizeLevel(level) {
  const normalized = String(level ?? "info").toLowerCase();
  return Object.hasOwn(LOG_LEVEL_PRIORITY, normalized) ? normalized : "info";
}

function shouldLog(level) {
  const minLevel = normalizeLevel(process.env.LOG_LEVEL ?? "info");
  return LOG_LEVEL_PRIORITY[normalizeLevel(level)] >= LOG_LEVEL_PRIORITY[minLevel];
}

function debugLog(level, operation, message, context = null) {
  if (!shouldLog(level)) return;
  const suffix = context ? ` ${JSON.stringify(context)}` : "";
  process.stderr.write(`[${normalizeLevel(level)}] [model-routing:${operation}] ${message}${suffix}\n`);
}

function aaacRoot() {
  const workspaceOverride = process.env.AAAC_WORKSPACE_ROOT;
  if (workspaceOverride) {
    return path.join(path.resolve(workspaceOverride), ".cursor", "aaac");
  }
  const fromPackage = path.resolve(__dirname, "../../../..", ".cursor", "aaac");
  if (fs.existsSync(path.join(fromPackage, "model-routing.yaml"))) {
    return fromPackage;
  }
  return path.resolve(__dirname, "../../..", "aaac");
}

const MODEL_ROUTING_PATH = path.join(aaacRoot(), "model-routing.yaml");

const DEFAULT_ROUTING = {
  version: 1,
  tiers: {
    fast: "composer-2.5-fast",
    codex: "gpt-5.3-codex-high-fast",
    reasoning: "claude-sonnet-5-thinking-high",
  },
  default_tier: "fast",
  phases: {
    discover: "fast",
    investigate_lite: "fast",
    investigate_swarm: "fast",
    research_swarm: "fast",
    check_swarm: "fast",
    verify: "fast",
    review_swarm: "fast",
    plan: "reasoning",
    validate: "reasoning",
    impact_analysis: "reasoning",
    dependency_graph: "reasoning",
    fitness_functions: "reasoning",
    rollback: "reasoning",
    root_cause: "reasoning",
    report: "reasoning",
    execute: "codex",
    test_execute: "codex",
    debt_sweep: "codex",
    scan: null,
    parse: null,
    campaign_init: null,
    plan_waves: null,
    satisfaction_gate: null,
  },
  agent_specs: {
    "code-author": "codex",
    "test-author": "codex",
    "discovery-*": "fast",
    "fix-*": "fast",
  },
  subagent_types: {
    explore: "fast",
    shell: "fast",
  },
};

let cachedRouting = null;

function parseSimpleYamlScalar(rawValue) {
  const clean = rawValue.split("#")[0].trim();
  if (!clean || clean === "null" || clean === "~") return null;
  if (clean === "true") return true;
  if (clean === "false") return false;
  if (/^-?\d+$/.test(clean)) return Number(clean);
  return clean.replace(/^['"]|['"]$/g, "");
}

function parseSimpleModelRoutingYaml(content) {
  const out = {
    version: null,
    tiers: {},
    default_tier: null,
    phases: {},
    agent_specs: {},
    subagent_types: {},
  };

  let section = null;
  const sectionKeys = new Set(["tiers", "phases", "agent_specs", "subagent_types"]);

  for (const line of content.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    if (/^\S/.test(line)) {
      const sectionMatch = line.match(/^([a-zA-Z0-9_\-]+):\s*$/);
      if (sectionMatch) {
        const key = sectionMatch[1];
        section = sectionKeys.has(key) ? key : null;
        continue;
      }

      const scalarMatch = line.match(/^([a-zA-Z0-9_\-]+):\s*(.+?)\s*$/);
      if (scalarMatch) {
        const [, key, rawValue] = scalarMatch;
        const value = parseSimpleYamlScalar(rawValue);
        if (key === "version") out.version = value;
        if (key === "default_tier") out.default_tier = value;
      }
      continue;
    }

    if (!section) continue;
    const nestedMatch = line.match(/^\s{2}([^:]+):\s*(.*?)\s*$/);
    if (!nestedMatch) continue;
    const nestedKey = nestedMatch[1].trim();
    const nestedValue = parseSimpleYamlScalar(nestedMatch[2]);
    out[section][nestedKey] = nestedValue;
  }

  return out;
}

function loadYamlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    debugLog("debug", "load_yaml", "model routing yaml missing; using defaults", { file_path: filePath });
    return null;
  }

  const content = fs.readFileSync(filePath, "utf8");
  try {
    const require = createRequire(import.meta.url);
    const pkgRoot = path.resolve(__dirname, "../..");
    const yaml = require(require.resolve("yaml", { paths: [pkgRoot] }));
    return yaml.parse(content);
  } catch {
    debugLog("debug", "load_yaml", "yaml package unavailable; using simple parser fallback", {
      file_path: filePath,
    });
    try {
      return parseSimpleModelRoutingYaml(content);
    } catch (error) {
      debugLog("warn", "load_yaml", "simple yaml parser failed; using defaults", {
        file_path: filePath,
        error: error?.message ?? String(error),
      });
      return null;
    }
  }
}

function normalizeRouting(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_ROUTING };
  }

  const tiers = {
    ...DEFAULT_ROUTING.tiers,
    ...(parsed.tiers ?? {}),
  };

  const defaultTier =
    typeof parsed.default_tier === "string" && parsed.default_tier
      ? parsed.default_tier
      : DEFAULT_ROUTING.default_tier;

  const normalized = {
    ...DEFAULT_ROUTING,
    ...parsed,
    tiers,
    default_tier: defaultTier,
    phases: {
      ...DEFAULT_ROUTING.phases,
      ...(parsed.phases ?? {}),
    },
    agent_specs: {
      ...DEFAULT_ROUTING.agent_specs,
      ...(parsed.agent_specs ?? {}),
    },
    subagent_types: {
      ...DEFAULT_ROUTING.subagent_types,
      ...(parsed.subagent_types ?? {}),
    },
  };

  if (!Object.hasOwn(tiers, normalized.default_tier)) {
    debugLog("warn", "normalize", "default_tier not found in tiers; falling back", {
      default_tier: normalized.default_tier,
      fallback: DEFAULT_ROUTING.default_tier,
    });
    normalized.default_tier = DEFAULT_ROUTING.default_tier;
  }

  return normalized;
}

export function loadModelRouting() {
  if (cachedRouting) return cachedRouting;

  debugLog("debug", "load", "loading model routing", { path: MODEL_ROUTING_PATH });
  const parsed = loadYamlFile(MODEL_ROUTING_PATH);
  cachedRouting = normalizeRouting(parsed);
  debugLog("debug", "load", "model routing loaded", {
    version: cachedRouting.version,
    default_tier: cachedRouting.default_tier,
  });
  return cachedRouting;
}

export function resetModelRoutingCache() {
  cachedRouting = null;
  debugLog("debug", "cache", "model routing cache reset");
}

export { MODEL_ROUTING_PATH };
