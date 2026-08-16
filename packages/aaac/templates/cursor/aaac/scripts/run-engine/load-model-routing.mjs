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
  const dogfood = path.resolve(__dirname, "../../../..", ".cursor", "aaac");
  if (fs.existsSync(path.join(dogfood, "model-routing.yaml"))) {
    return dogfood;
  }
  const packaged = path.resolve(__dirname, "../../templates/cursor/aaac");
  if (fs.existsSync(path.join(packaged, "model-routing.yaml"))) {
    return packaged;
  }
  return path.resolve(__dirname, "../../..", "aaac");
}

function getModelRoutingPath() {
  return path.join(aaacRoot(), "model-routing.yaml");
}

/** AAAC may only dispatch Grok 4.6 variants. */
export const AAAC_MODEL_PROVIDER = "grok";
export const AAAC_MODEL_FAMILY = "grok-4.6";
/** Cursor CLI / Task slugs require `cursor-` plus an effort token. */
export const DEFAULT_CURSOR_GROK_EFFORT = "medium";
export const DEFAULT_AAAC_MODEL_SLUG = "cursor-grok-4.6-medium-fast";
export const AAAC_ALLOWED_MODEL_PATTERN = /^(cursor-)?grok-4\.6(?:-[a-z0-9]+)*$/i;
const CURSOR_GROK_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

export function isAllowedAaacModelSlug(slug) {
  return typeof slug === "string" && AAAC_ALLOWED_MODEL_PATTERN.test(slug.trim());
}

/**
 * Map AAAC Grok shorthand onto a Cursor CLI / Task model id.
 * `grok-4.6-fast` is not a Cursor model; the CLI expects
 * `cursor-grok-4.6-{low|medium|high|xhigh}[-fast]`.
 */
export function toCursorCliModelSlug(slug, fallback = DEFAULT_AAAC_MODEL_SLUG) {
  const raw = typeof slug === "string" ? slug.trim() : "";
  const source = isAllowedAaacModelSlug(raw)
    ? raw
    : isAllowedAaacModelSlug(fallback)
      ? fallback.trim()
      : DEFAULT_AAAC_MODEL_SLUG;
  const normalized = source.toLowerCase().replace(/^cursor-/, "");
  if (!normalized.startsWith("grok-4.6")) {
    return DEFAULT_AAAC_MODEL_SLUG;
  }

  const tokens = normalized
    .slice("grok-4.6".length)
    .replace(/^-/, "")
    .split("-")
    .filter(Boolean);
  const fast = tokens.includes("fast");
  let effort = null;
  if (tokens.includes("xhigh") || (tokens.includes("extra") && tokens.includes("high"))) {
    effort = "xhigh";
  } else if (tokens.includes("high")) {
    effort = "high";
  } else if (tokens.includes("medium")) {
    effort = "medium";
  } else if (tokens.includes("low")) {
    effort = "low";
  } else if (tokens.includes("max")) {
    effort = "xhigh";
  } else if (tokens.includes("none")) {
    effort = DEFAULT_CURSOR_GROK_EFFORT;
  }
  if (!CURSOR_GROK_EFFORTS.has(effort)) {
    effort = DEFAULT_CURSOR_GROK_EFFORT;
  }
  return `cursor-grok-4.6-${effort}${fast ? "-fast" : ""}`;
}

function coerceGrokSlug(slug, fallback = DEFAULT_AAAC_MODEL_SLUG) {
  if (slug == null) return slug;
  if (isAllowedAaacModelSlug(slug)) {
    return toCursorCliModelSlug(slug, fallback);
  }
  debugLog("warn", "coerce", "rejected non-Grok model slug", {
    slug,
    fallback,
    provider: AAAC_MODEL_PROVIDER,
    family: AAAC_MODEL_FAMILY,
  });
  return toCursorCliModelSlug(fallback);
}

function coerceTiers(tiers) {
  const out = {};
  for (const [name, slug] of Object.entries(tiers ?? {})) {
    const fallback = DEFAULT_ROUTING.tiers[name] ?? DEFAULT_AAAC_MODEL_SLUG;
    out[name] = coerceGrokSlug(slug, fallback);
  }
  return out;
}

const DEFAULT_ROUTING = {
  version: 1,
  provider: AAAC_MODEL_PROVIDER,
  family: AAAC_MODEL_FAMILY,
  tiers: {
    low: "cursor-grok-4.6-low-fast",
    medium: "cursor-grok-4.6-medium-fast",
    high: "cursor-grok-4.6-high-fast",
    critical: "cursor-grok-4.6-xhigh-fast",
    fast: "cursor-grok-4.6-medium-fast",
    codex: "cursor-grok-4.6-high-fast",
    reasoning: "cursor-grok-4.6-xhigh-fast",
  },
  default_tier: "low",
  critical_tier: "critical",
  verb_critical_phases: {
    check: "discover",
    fix: "plan",
    create: "plan",
    update: "plan",
  },
  command_critical_phases: {},
  phases: {
    discover: "medium",
    investigate_lite: "medium",
    investigate_swarm: "medium",
    research_swarm: "medium",
    check_swarm: "medium",
    verify: "low",
    review_swarm: "low",
    plan: "medium",
    validate: "low",
    impact_analysis: "low",
    dependency_graph: "low",
    fitness_functions: "low",
    rollback: "low",
    root_cause: "medium",
    report: "medium",
    execute: "high",
    test_execute: "high",
    debt_sweep: "high",
    scan: null,
    parse: null,
    campaign_init: null,
    plan_waves: null,
    satisfaction_gate: null,
  },
  agent_specs: {
    "code-author": "high",
    "test-author": "high",
    "discovery-*": "medium",
    "fix-*": "low",
  },
  subagent_types: {
    explore: "medium",
    shell: "low",
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
    critical_tier: null,
    verb_critical_phases: {},
    command_critical_phases: {},
    phases: {},
    agent_specs: {},
    subagent_types: {},
  };

  let section = null;
  const sectionKeys = new Set([
    "tiers",
    "phases",
    "agent_specs",
    "subagent_types",
    "verb_critical_phases",
    "command_critical_phases",
  ]);

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
        if (key === "critical_tier") out.critical_tier = value;
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

  const tiers = coerceTiers({
    ...DEFAULT_ROUTING.tiers,
    ...(parsed.tiers ?? {}),
  });

  const defaultTier =
    typeof parsed.default_tier === "string" && parsed.default_tier
      ? parsed.default_tier
      : DEFAULT_ROUTING.default_tier;

  const criticalTier =
    typeof parsed.critical_tier === "string" && parsed.critical_tier
      ? parsed.critical_tier
      : DEFAULT_ROUTING.critical_tier;

  const normalized = {
    ...DEFAULT_ROUTING,
    ...parsed,
    provider: AAAC_MODEL_PROVIDER,
    family: AAAC_MODEL_FAMILY,
    tiers,
    default_tier: defaultTier,
    critical_tier: criticalTier,
    verb_critical_phases: {
      ...DEFAULT_ROUTING.verb_critical_phases,
      ...(parsed.verb_critical_phases ?? {}),
    },
    command_critical_phases: {
      ...DEFAULT_ROUTING.command_critical_phases,
      ...(parsed.command_critical_phases ?? {}),
    },
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

  const routingPath = getModelRoutingPath();
  debugLog("debug", "load", "loading model routing", { path: routingPath });
  const parsed = loadYamlFile(routingPath);
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

export { getModelRoutingPath, getModelRoutingPath as MODEL_ROUTING_PATH };
