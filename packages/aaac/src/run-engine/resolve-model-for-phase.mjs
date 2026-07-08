/**
 * Resolve model tier + slug for a phase/subagent launch.
 * Precedence: agent_specs > phases > subagent_types > default_tier
 */
import { MODEL_ROUTING_PATH, loadModelRouting } from "./load-model-routing.mjs";

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
  process.stderr.write(`[${normalizeLevel(level)}] [model-routing-resolver:${operation}] ${message}${suffix}\n`);
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function wildcardToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function resolveAgentSpecTier(agentSpecs, agentSpecId) {
  if (!agentSpecId || !agentSpecs || typeof agentSpecs !== "object") {
    return { tier: undefined, key: null };
  }

  if (hasOwn(agentSpecs, agentSpecId)) {
    return { tier: agentSpecs[agentSpecId], key: agentSpecId };
  }

  for (const key of Object.keys(agentSpecs)) {
    if (!key.includes("*")) continue;
    if (wildcardToRegex(key).test(agentSpecId)) {
      return { tier: agentSpecs[key], key };
    }
  }

  return { tier: undefined, key: null };
}

export function resolveModelTierDetail({ phase, agent_spec_id, subagent_type } = {}) {
  const routing = loadModelRouting();
  const routingPath = [];

  const agentSpecResult = resolveAgentSpecTier(routing.agent_specs, agent_spec_id);
  routingPath.push({
    source: "agent_specs",
    key: agentSpecResult.key ?? agent_spec_id ?? null,
    tier: agentSpecResult.tier ?? null,
    matched: agentSpecResult.tier !== undefined,
  });
  if (agentSpecResult.tier !== undefined) {
    const tier = agentSpecResult.tier ?? null;
    const parentOnly = tier == null;
    const modelSlug = tier == null ? null : (routing.tiers?.[tier] ?? null);
    const detail = {
      tier,
      model_slug: modelSlug,
      source: "agent_specs",
      ...(parentOnly ? { parent_only: true } : {}),
      routing_path: routingPath,
    };
    debugLog("debug", "resolve", "resolved by agent spec", {
      phase,
      agent_spec_id,
      subagent_type,
      tier: detail.tier,
      model_slug: detail.model_slug,
    });
    return detail;
  }

  const hasPhaseTier = hasOwn(routing.phases, phase);
  const phaseTier = hasPhaseTier ? routing.phases[phase] : undefined;
  routingPath.push({
    source: "phases",
    key: phase ?? null,
    tier: phaseTier ?? null,
    matched: hasPhaseTier,
  });
  if (hasPhaseTier) {
    const tier = phaseTier ?? null;
    const parentOnly = tier == null;
    const modelSlug = tier == null ? null : (routing.tiers?.[tier] ?? null);
    const detail = {
      tier,
      model_slug: modelSlug,
      source: "phases",
      ...(parentOnly ? { parent_only: true } : {}),
      routing_path: routingPath,
    };
    debugLog("debug", "resolve", "resolved by phase", {
      phase,
      agent_spec_id,
      subagent_type,
      tier: detail.tier,
      model_slug: detail.model_slug,
      parent_only: !!detail.parent_only,
    });
    return detail;
  }

  const hasSubagentTypeTier = hasOwn(routing.subagent_types, subagent_type);
  const subagentTier = hasSubagentTypeTier ? routing.subagent_types[subagent_type] : undefined;
  routingPath.push({
    source: "subagent_types",
    key: subagent_type ?? null,
    tier: subagentTier ?? null,
    matched: hasSubagentTypeTier,
  });
  if (hasSubagentTypeTier) {
    const tier = subagentTier ?? null;
    const parentOnly = tier == null;
    const modelSlug = tier == null ? null : (routing.tiers?.[tier] ?? null);
    const detail = {
      tier,
      model_slug: modelSlug,
      source: "subagent_types",
      ...(parentOnly ? { parent_only: true } : {}),
      routing_path: routingPath,
    };
    debugLog("debug", "resolve", "resolved by subagent type", {
      phase,
      agent_spec_id,
      subagent_type,
      tier: detail.tier,
      model_slug: detail.model_slug,
    });
    return detail;
  }

  const defaultTier = routing.default_tier ?? null;
  routingPath.push({
    source: "default_tier",
    key: "default_tier",
    tier: defaultTier,
    matched: defaultTier != null,
  });

  const defaultDetail = {
    tier: defaultTier,
    model_slug: defaultTier == null ? null : (routing.tiers?.[defaultTier] ?? null),
    source: "default_tier",
    ...(defaultTier == null ? { parent_only: true } : {}),
    routing_path: routingPath,
  };

  debugLog("debug", "resolve", "resolved by default tier", {
    phase,
    agent_spec_id,
    subagent_type,
    tier: defaultDetail.tier,
    model_slug: defaultDetail.model_slug,
    routing_path_length: routingPath.length,
  });

  return defaultDetail;
}

export function resolveModelForPhase(args = {}) {
  const detail = resolveModelTierDetail(args);
  const result = {
    tier: detail.tier ?? null,
    model_slug: detail.parent_only || detail.tier == null ? null : detail.model_slug ?? null,
    source: detail.source,
    ...(detail.parent_only ? { parent_only: true } : {}),
  };

  debugLog("debug", "resolve_phase", "resolved model for phase", {
    ...args,
    ...result,
    routing_path: MODEL_ROUTING_PATH,
  });

  return result;
}

export { MODEL_ROUTING_PATH };
