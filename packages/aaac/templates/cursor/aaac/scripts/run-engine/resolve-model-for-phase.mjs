/**
 * Resolve model tier + slug for a phase/subagent launch.
 * Precedence: command/verb critical phase > agent_specs > phases > subagent_types > default_tier
 */
import { getModelRoutingPath, loadModelRouting } from "./load-model-routing.mjs";

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

function normalizeRouteKey(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^\//, "").toLowerCase();
  return trimmed || null;
}

function resolveCriticalMatch(routing, { command, verb, phase }) {
  const criticalTier = routing.critical_tier ?? "critical";
  if (!phase || !hasOwn(routing.tiers, criticalTier)) {
    return { matched: false, source: null, key: null, tier: undefined };
  }
  const commands = routing.command_critical_phases ?? {};
  const verbs = routing.verb_critical_phases ?? {};
  const cmd = normalizeRouteKey(command);
  const v = normalizeRouteKey(verb);

  if (cmd && hasOwn(commands, cmd)) {
    if (commands[cmd] === phase) {
      return { matched: true, source: "command_critical_phases", key: cmd, tier: criticalTier };
    }
    return { matched: false, source: null, key: null, tier: undefined };
  }
  if (v && hasOwn(verbs, v) && verbs[v] === phase) {
    return { matched: true, source: "verb_critical_phases", key: v, tier: criticalTier };
  }
  if (!v && cmd) {
    const inferred = cmd.split(/[-_]/)[0];
    if (inferred && hasOwn(verbs, inferred) && verbs[inferred] === phase) {
      return { matched: true, source: "verb_critical_phases", key: inferred, tier: criticalTier };
    }
  }
  return { matched: false, source: null, key: null, tier: undefined };
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

export function resolveModelTierDetail({
  phase,
  agent_spec_id,
  subagent_type,
  verb,
  command,
} = {}) {
  const routing = loadModelRouting();
  const routingPath = [];

  const critical = resolveCriticalMatch(routing, { command, verb, phase });
  routingPath.push({
    source: critical.source ?? "critical_phase",
    key: critical.key,
    tier: critical.tier ?? null,
    matched: critical.matched,
  });
  if (critical.matched) {
    const detail = {
      tier: critical.tier,
      model_slug: routing.tiers?.[critical.tier] ?? null,
      source: critical.source,
      routing_path: routingPath,
    };
    debugLog("debug", "resolve", "resolved by command/verb critical phase", {
      phase,
      verb,
      command,
      agent_spec_id,
      tier: detail.tier,
      model_slug: detail.model_slug,
      source: detail.source,
    });
    return detail;
  }

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
    routing_path: getModelRoutingPath(),
  });

  return result;
}

export { getModelRoutingPath as MODEL_ROUTING_PATH };
