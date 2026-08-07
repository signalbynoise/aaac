import { afterAll, beforeAll, expect, it } from "vitest";
import {
  estimateStageCostUsd,
  estimateUsageCostUsd,
  normalizeModelSlug,
  resolvePricingModelKey,
} from "../src/run-engine/estimate-token-cost.mjs";
import {
  loadModelPricing,
  resetModelPricingCache,
} from "../src/run-engine/load-model-pricing.mjs";

beforeAll(() => {
  resetModelPricingCache();
});

afterAll(() => {
  resetModelPricingCache();
});

it("loads Cursor-sourced rates with fetched_at", () => {
    const pricing = loadModelPricing();
    expect(Object.keys(pricing.models).length).toBeGreaterThanOrEqual(10);
    expect(pricing.currency).toBe("USD");
    expect(pricing.source?.url).toContain("models-and-pricing");
    expect(pricing.source?.fetched_at).toBeTruthy();
    expect(pricing.models["composer-2.5"]?.input_per_million).toBe(0.5);
    expect(pricing.models["composer-2.5"]?.output_per_million).toBe(2.5);
    expect(pricing.models["grok-4.5"]?.input_per_million).toBe(2);
    expect(pricing.models["grok-4.5"]?.output_per_million).toBe(6);
});

it("resolves agent slugs via aliases", () => {
    expect(normalizeModelSlug("cursor-grok-4.5-high-fast")).toBe("grok-4.5");
    expect(resolvePricingModelKey("cursor-grok-4.5-high-fast")).toBe("grok-4.5-fast");
    expect(resolvePricingModelKey("cursor-grok-4.5-medium-fast")).toBe("grok-4.5-fast");
    expect(resolvePricingModelKey("composer-2.5-fast")).toBe("composer-2.5");
    expect(resolvePricingModelKey("gpt-5.3-codex-high-fast")).toBe("gpt-5.3-codex");
    expect(loadModelPricing().models["grok-4.5-fast"]?.input_per_million).toBe(4);
    expect(loadModelPricing().models["grok-4.5-fast"]?.output_per_million).toBe(18);
});

it("estimates from input/output meters without inventing", () => {
    const priced = estimateUsageCostUsd({
      model: "composer-2.5",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(priced.estimated_cost_usd).toBe(3); // 0.5 + 2.5
    expect(priced.cost_method).toBe("input_output");
    expect(priced.cost_quality).toBe("metered");

    const missing = estimateUsageCostUsd({ model: "not-a-real-model", total_tokens: 1000 });
    expect(missing.estimated_cost_usd).toBeNull();
    expect(missing.reason).toMatch(/unknown_model/);

    const noTokens = estimateUsageCostUsd({ model: "composer-2.5" });
    expect(noTokens.estimated_cost_usd).toBeNull();
    expect(noTokens.reason).toBe("missing_tokens");
});

it("uses documented blend for total-only tokens", () => {
    // 1M total → 0.75M in * 0.5 + 0.25M out * 2.5 = 0.375 + 0.625 = 1
    const priced = estimateUsageCostUsd({
      model: "composer-2.5-fast",
      total_tokens: 1_000_000,
    });
    expect(priced.estimated_cost_usd).toBe(1);
    expect(priced.cost_method).toBe("blended_total");
    expect(priced.cost_quality).toBe("blended");
});

it("stage cost is null/unavailable when agents unmetered — no duration_share SSOT", () => {
    const manifest = {
      metrics: { conversation_tokens: 100_000 },
      phase_metrics: {
        discover: { duration_ms: 25_000 },
        execute: { duration_ms: 75_000 },
      },
      swarm_history: {
        discover: {
          agents: [{ phase: "discover", model: "composer-2.5-fast" }],
        },
        execute: {
          agents: [{ phase: "execute", model: "gpt-5.3-codex-high-fast" }],
        },
      },
    };

    const discover = estimateStageCostUsd(manifest, "discover");
    expect(discover.estimated_cost_usd).toBeNull();
    expect(discover.cost_method).toBeNull();
    expect(discover.cost_quality).toBeNull();
    expect(discover.cost_method).not.toBe("duration_share_of_conversation_tokens");
    expect(
      discover.reason === "missing_tokens" ||
        discover.reason === "missing_model_and_tokens",
    ).toBe(true);

    const execute = estimateStageCostUsd(manifest, "execute");
    expect(execute.estimated_cost_usd).toBeNull();
    expect(execute.cost_method).toBeNull();
    expect(execute.cost_method).not.toBe("duration_share_of_conversation_tokens");
});

it("stage cost uses sealed agent meters when present", () => {
    const manifest = {
      swarm_history: {
        discover: {
          agents: [
            {
              phase: "discover",
              model: "composer-2.5-fast",
              tokens: 1_000_000,
            },
          ],
        },
      },
    };

    const discover = estimateStageCostUsd(manifest, "discover");
    expect(discover.estimated_cost_usd).toBe(1);
    expect(discover.cost_method).toBe("blended_total");
    expect(discover.cost_quality).toBe("blended");
    expect(discover.reason).toBeNull();
});

it("stage cost prefers input/output/cache components over blended totals", () => {
    const manifest = {
      swarm_history: {
        discover: {
          agents: [
            {
              phase: "discover",
              model: "cursor-grok-4.5-medium-fast",
              tokens: 500_000,
              input_tokens: 70_000,
              output_tokens: 1_000,
              cache_read_tokens: 429_000,
              cache_write_tokens: 0,
            },
          ],
        },
      },
    };

    // Fast rates: 70k*$4 + 1k*$18 + 429k*$0.5 per million
    const discover = estimateStageCostUsd(manifest, "discover");
    expect(discover.cost_method).toBe("input_output");
    expect(discover.cost_quality).toBe("metered");
    expect(discover.estimated_cost_usd).toBeCloseTo(
      (70_000 / 1e6) * 4 + (1_000 / 1e6) * 18 + (429_000 / 1e6) * 0.5,
      6,
    );
});
