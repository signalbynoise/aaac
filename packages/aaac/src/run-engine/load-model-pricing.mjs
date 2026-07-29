#!/usr/bin/env node
/**
 * Load model-pricing.yaml SSOT (cached).
 * Rates must come from this file — never hardcode prices in callers.
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
  process.stderr.write(`[${normalizeLevel(level)}] [model-pricing:${operation}] ${message}${suffix}\n`);
}

function aaacRoot() {
  const workspaceOverride = process.env.AAAC_WORKSPACE_ROOT;
  if (workspaceOverride) {
    return path.join(path.resolve(workspaceOverride), ".cursor", "aaac");
  }
  const dogfood = path.resolve(__dirname, "../../../..", ".cursor", "aaac");
  if (fs.existsSync(path.join(dogfood, "model-pricing.yaml"))) {
    return dogfood;
  }
  const packaged = path.resolve(__dirname, "../../templates/cursor/aaac");
  if (fs.existsSync(path.join(packaged, "model-pricing.yaml"))) {
    return packaged;
  }
  return path.resolve(__dirname, "../../..", "aaac");
}

const MODEL_PRICING_PATH = path.join(aaacRoot(), "model-pricing.yaml");

const EMPTY_PRICING = {
  version: 1,
  currency: "USD",
  unit: "per_million_tokens",
  pricing_basis: "api_pool",
  source: { url: null, fetched_at: null, note: null },
  blend: { input_share: 0.75, output_share: 0.25 },
  allocation: { when_phase_tokens_missing: null },
  cursor_token_rate: { per_million: 0.25, default_enabled: false, exempt_pools: ["first_party", "auto"] },
  aliases: {},
  models: {},
};

let cachedPricing = null;

function loadYamlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    debugLog("warn", "load_yaml", "model pricing yaml missing", { file_path: filePath });
    return null;
  }
  const content = fs.readFileSync(filePath, "utf8");
  try {
    const require = createRequire(import.meta.url);
    const searchRoots = [
      path.resolve(__dirname, "../.."), // packages/aaac or .cursor/aaac
      path.resolve(__dirname, "../../../..", "packages", "aaac"),
      path.resolve(__dirname, "../../../../..", "packages", "aaac"),
      process.cwd(),
    ];
    const yaml = require(require.resolve("yaml", { paths: searchRoots }));
    return yaml.parse(content);
  } catch (error) {
    debugLog("error", "load_yaml", "failed to parse model-pricing.yaml", {
      file_path: filePath,
      error: error?.message ?? String(error),
    });
    return null;
  }
}

function asShare(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

function normalizePricing(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { ...EMPTY_PRICING, models: {}, aliases: {} };
  }

  const blendIn = asShare(parsed.blend?.input_share, EMPTY_PRICING.blend.input_share);
  const blendOut = asShare(parsed.blend?.output_share, EMPTY_PRICING.blend.output_share);
  const blendSum = blendIn + blendOut;

  const allocationMissing = parsed.allocation?.when_phase_tokens_missing;
  const allocation =
    allocationMissing === "duration_share_of_conversation_tokens" || allocationMissing == null
      ? allocationMissing ?? null
      : null;

  return {
    ...EMPTY_PRICING,
    ...parsed,
    currency: parsed.currency ?? EMPTY_PRICING.currency,
    unit: parsed.unit ?? EMPTY_PRICING.unit,
    pricing_basis: parsed.pricing_basis ?? EMPTY_PRICING.pricing_basis,
    source: {
      ...EMPTY_PRICING.source,
      ...(parsed.source ?? {}),
    },
    blend: {
      input_share: blendSum > 0 ? blendIn / blendSum : EMPTY_PRICING.blend.input_share,
      output_share: blendSum > 0 ? blendOut / blendSum : EMPTY_PRICING.blend.output_share,
    },
    allocation: {
      when_phase_tokens_missing: allocation,
    },
    cursor_token_rate: {
      ...EMPTY_PRICING.cursor_token_rate,
      ...(parsed.cursor_token_rate ?? {}),
    },
    aliases: parsed.aliases && typeof parsed.aliases === "object" ? parsed.aliases : {},
    models: parsed.models && typeof parsed.models === "object" ? parsed.models : {},
  };
}

export function loadModelPricing() {
  if (cachedPricing) return cachedPricing;
  debugLog("debug", "load", "loading model pricing", { path: MODEL_PRICING_PATH });
  const parsed = loadYamlFile(MODEL_PRICING_PATH);
  cachedPricing = normalizePricing(parsed);
  debugLog("debug", "load", "model pricing loaded", {
    version: cachedPricing.version,
    model_count: Object.keys(cachedPricing.models).length,
    fetched_at: cachedPricing.source?.fetched_at ?? null,
  });
  return cachedPricing;
}

export function resetModelPricingCache() {
  cachedPricing = null;
  debugLog("debug", "cache", "model pricing cache reset");
}

export { MODEL_PRICING_PATH, EMPTY_PRICING };
