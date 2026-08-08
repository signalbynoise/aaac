#!/usr/bin/env node
/**
 * Estimate USD cost from sealed token meters + model-pricing.yaml SSOT.
 * Never invents rates. Returns null cost when model/tokens/pricing unavailable.
 */
import { loadModelPricing } from "./load-model-pricing.mjs";

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
  process.stderr.write(`[${normalizeLevel(level)}] [token-cost:${operation}] ${message}${suffix}\n`);
}

function asFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Strip common Cursor effort/speed suffixes for alias lookup fallback. */
export function normalizeModelSlug(raw) {
  if (raw == null) return null;
  let slug = String(raw).trim().toLowerCase();
  if (!slug || slug === "null" || slug === "undefined") return null;
  slug = slug.replace(/^cursor-/, "");
  // Peel known trailing modifiers repeatedly.
  let prev = null;
  while (prev !== slug) {
    prev = slug;
    slug = slug.replace(/-(thinking|fast|high|medium|low|max)(-fast|-high|-medium|-low)?$/, "");
  }
  return slug || null;
}

export function resolvePricingModelKey(modelSlug, pricing = loadModelPricing()) {
  if (!modelSlug) return null;
  const raw = String(modelSlug).trim().toLowerCase();
  if (pricing.aliases?.[raw]) return pricing.aliases[raw];
  const normalized = normalizeModelSlug(raw);
  if (normalized && pricing.aliases?.[normalized]) return pricing.aliases[normalized];
  if (pricing.models?.[raw]) return raw;
  if (normalized && pricing.models?.[normalized]) return normalized;
  return null;
}

export function getModelRates(modelSlug, pricing = loadModelPricing()) {
  const key = resolvePricingModelKey(modelSlug, pricing);
  if (!key) return null;
  const model = pricing.models?.[key];
  if (!model || typeof model !== "object") return null;
  const input = asFiniteNumber(model.input_per_million);
  const output = asFiniteNumber(model.output_per_million);
  if (input == null || output == null) return null;
  return {
    key,
    pool: model.pool ?? "api",
    input_per_million: input,
    output_per_million: output,
    cache_read_per_million: asFiniteNumber(model.cache_read_per_million),
    cache_write_per_million: asFiniteNumber(model.cache_write_per_million),
    context_window: asFiniteNumber(model.context_window),
  };
}

/**
 * Model context window (tokens) from model-pricing.yaml SSOT.
 * @returns {number|null}
 */
export function getModelContextWindow(modelSlug, pricing = loadModelPricing()) {
  const key = resolvePricingModelKey(modelSlug, pricing);
  if (!key) return null;
  const window = asFiniteNumber(pricing.models?.[key]?.context_window);
  return window != null && window > 0 ? window : null;
}

/**
 * Context usage % = (input + output) / model_context_window * 100.
 * Cache tokens are excluded (reported separately by callers).
 */
export function computeContextPercent({
  inputTokens = 0,
  outputTokens = 0,
  model,
  contextWindow = null,
  pricing = null,
} = {}) {
  const window =
    (typeof contextWindow === "number" && contextWindow > 0
      ? contextWindow
      : null) ??
    getModelContextWindow(model, pricing ?? loadModelPricing());
  if (window == null || window <= 0) return null;
  const inTok = Number(inputTokens) || 0;
  const outTok = Number(outputTokens) || 0;
  if (inTok < 0 || outTok < 0) return null;
  return ((inTok + outTok) / window) * 100;
}

/**
 * @param {{ model: string|null, input_tokens?: number|null, output_tokens?: number|null, total_tokens?: number|null, cache_read_tokens?: number|null, cache_write_tokens?: number|null }} usage
 * @param {{ pricing?: object, apply_cursor_token_rate?: boolean }} [opts]
 */
export function estimateUsageCostUsd(usage, opts = {}) {
  const pricing = opts.pricing ?? loadModelPricing();
  const rates = getModelRates(usage?.model, pricing);
  if (!rates) {
    return {
      estimated_cost_usd: null,
      cost_method: null,
      cost_quality: null,
      pricing_model_key: null,
      reason: usage?.model ? `unknown_model:${usage.model}` : "missing_model",
    };
  }

  const inputTokens = asFiniteNumber(usage.input_tokens);
  const outputTokens = asFiniteNumber(usage.output_tokens);
  const totalTokens = asFiniteNumber(usage.total_tokens);
  const cacheRead = asFiniteNumber(usage.cache_read_tokens) ?? 0;
  const cacheWrite = asFiniteNumber(usage.cache_write_tokens) ?? 0;

  let method = null;
  let quality = null;
  let inTok = null;
  let outTok = null;

  if (inputTokens != null && outputTokens != null && inputTokens >= 0 && outputTokens >= 0) {
    inTok = inputTokens;
    outTok = outputTokens;
    method = "input_output";
    quality = "metered";
  } else if (totalTokens != null && totalTokens >= 0) {
    const inShare = pricing.blend?.input_share ?? 0.75;
    const outShare = pricing.blend?.output_share ?? 0.25;
    inTok = totalTokens * inShare;
    outTok = totalTokens * outShare;
    method = "blended_total";
    quality = "blended";
  } else {
    return {
      estimated_cost_usd: null,
      cost_method: null,
      cost_quality: null,
      pricing_model_key: rates.key,
      reason: "missing_tokens",
    };
  }

  const perM = 1_000_000;
  let usd =
    (inTok / perM) * rates.input_per_million + (outTok / perM) * rates.output_per_million;

  if (cacheRead > 0 && rates.cache_read_per_million != null) {
    usd += (cacheRead / perM) * rates.cache_read_per_million;
  }
  if (cacheWrite > 0 && rates.cache_write_per_million != null) {
    usd += (cacheWrite / perM) * rates.cache_write_per_million;
  }

  const rateCfg = pricing.cursor_token_rate ?? {};
  const applyRate =
    opts.apply_cursor_token_rate ?? Boolean(rateCfg.default_enabled);
  const exempt = new Set(rateCfg.exempt_pools ?? ["first_party", "auto"]);
  if (applyRate && !exempt.has(rates.pool) && rates.pool !== "first_party") {
    const surcharge = asFiniteNumber(rateCfg.per_million) ?? 0;
    const billable = (inTok ?? 0) + (outTok ?? 0) + cacheRead + cacheWrite;
    usd += (billable / perM) * surcharge;
  }

  return {
    estimated_cost_usd: Number(usd.toFixed(6)),
    cost_method: method,
    cost_quality: quality,
    pricing_model_key: rates.key,
    reason: null,
  };
}

function agentsForPhase(manifest, phase) {
  const historyAgents = manifest.swarm_history?.[phase]?.agents;
  if (Array.isArray(historyAgents) && historyAgents.length) return historyAgents;
  return (manifest.swarm?.agents ?? []).filter((agent) => agent.phase === phase);
}

function dominantModel(agents, fallbackModel) {
  const counts = new Map();
  for (const agent of agents) {
    const model = agent.model ?? agent.expected_model ?? null;
    if (!model) continue;
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  if (!counts.size) return fallbackModel ?? null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Estimate sealed stage cost for one phase.
 * Precedence: sealed agent meters → phase_metrics.tokens from sealed meters.
 * Never invent via duration_share / conversation allocation — null when unmetered.
 */
export function estimateStageCostUsd(manifest, phase, opts = {}) {
  const pricing = opts.pricing ?? loadModelPricing();
  const agents = opts.agents ?? agentsForPhase(manifest, phase);
  const phaseMetrics =
    manifest.phase_metrics?.[phase] ??
    manifest.swarm_history?.[phase]?.phase_metrics ??
    {};

  const agentCosts = [];
  let pricedAgents = 0;
  let tokenBearingAgents = 0;

  for (const agent of agents) {
    const tokens = asFiniteNumber(agent.tokens);
    const inputTokens = asFiniteNumber(agent.input_tokens);
    const outputTokens = asFiniteNumber(agent.output_tokens);
    const hasTokens =
      (tokens != null && tokens >= 0) ||
      (inputTokens != null && outputTokens != null);
    if (!hasTokens) continue;
    tokenBearingAgents += 1;
    const result = estimateUsageCostUsd(
      {
        model: agent.model ?? agent.expected_model ?? null,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: tokens,
        cache_read_tokens: agent.cache_read_tokens,
        cache_write_tokens: agent.cache_write_tokens,
      },
      { pricing, apply_cursor_token_rate: opts.apply_cursor_token_rate },
    );
    if (result.estimated_cost_usd == null) {
      debugLog("debug", "stage", "agent cost unavailable", {
        phase,
        reason: result.reason,
        model: agent.model ?? null,
      });
      return {
        estimated_cost_usd: null,
        cost_method: null,
        cost_quality: null,
        pricing_model_key: result.pricing_model_key,
        pricing_fetched_at: pricing.source?.fetched_at ?? null,
        reason: result.reason ?? "agent_unpriced",
      };
    }
    pricedAgents += 1;
    agentCosts.push(result);
  }

  if (pricedAgents > 0 && pricedAgents === tokenBearingAgents) {
    const usd = agentCosts.reduce((sum, row) => sum + row.estimated_cost_usd, 0);
    const methods = new Set(agentCosts.map((row) => row.cost_method));
    const qualities = new Set(agentCosts.map((row) => row.cost_quality));
    return {
      estimated_cost_usd: Number(usd.toFixed(6)),
      cost_method: methods.size === 1 ? [...methods][0] : "agent_aggregate",
      cost_quality: qualities.has("blended") ? "blended" : "metered",
      pricing_model_key: dominantModel(
        agents,
        agentCosts[0]?.pricing_model_key ?? null,
      ),
      pricing_fetched_at: pricing.source?.fetched_at ?? null,
      reason: null,
    };
  }

  const phaseTokens = asFiniteNumber(phaseMetrics.tokens);
  const model =
    dominantModel(agents, null) ??
    opts.fallback_model ??
    null;

  if (phaseTokens != null && phaseTokens > 0) {
    const result = estimateUsageCostUsd(
      { model, total_tokens: phaseTokens },
      { pricing, apply_cursor_token_rate: opts.apply_cursor_token_rate },
    );
    return {
      ...result,
      pricing_fetched_at: pricing.source?.fetched_at ?? null,
      cost_method: result.cost_method ? `phase_tokens_${result.cost_method}` : null,
    };
  }

  return {
    estimated_cost_usd: null,
    cost_method: null,
    cost_quality: null,
    pricing_model_key: resolvePricingModelKey(model, pricing),
    pricing_fetched_at: pricing.source?.fetched_at ?? null,
    reason: model ? "missing_tokens" : "missing_model_and_tokens",
  };
}
