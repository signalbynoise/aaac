import { describe, it, expect, beforeEach } from "vitest";
import {
  loadSwarmSizing,
  resetSwarmSizingCache,
  tierLookup,
  getPhaseClass,
  resolveSwarmFloor,
} from "../src/run-engine/load-swarm-sizing.mjs";
import {
  resolveSwarmTargetDetail,
  applySwarmTargetsToManifest,
} from "../src/run-engine/resolve-swarm-target.mjs";
import { resolveSwarmWaves } from "../src/run-engine/resolve-swarm-waves.mjs";
import { computeBootstrapScopeScore } from "../src/run-engine/swarm-complexity-lib.mjs";

describe("load-swarm-sizing", () => {
  beforeEach(() => resetSwarmSizingCache());

  it("loads floors from swarm-sizing.yaml", () => {
    const sizing = loadSwarmSizing({ swarm_min_agents: { discover: 4 } });
    expect(sizing.floors.discover).toBe(4);
    expect(sizing.scope_tiers?.discover?.length).toBeGreaterThan(0);
  });

  it("tierLookup picks agents by score ceiling", () => {
    const tiers = [
      { max: 2, agents: 4 },
      { max: 6, agents: 5 },
      { max: 999, agents: 8 },
    ];
    expect(tierLookup(tiers, 0)).toBe(4);
    expect(tierLookup(tiers, 6)).toBe(5);
    expect(tierLookup(tiers, 20)).toBe(8);
  });

  it("classifies discover as scope_driven", () => {
    const sizing = loadSwarmSizing({});
    expect(getPhaseClass("discover", sizing)).toBe("scope_driven");
    expect(getPhaseClass("validate", sizing)).toBe("change_driven");
    expect(getPhaseClass("execute", sizing)).toBe("fixed");
  });
});

describe("resolve-swarm-target", () => {
  beforeEach(() => resetSwarmSizingCache());

  it("uses floor when scope score is low", () => {
    const manifest = {
      command: "create-module",
      verb: "create",
      object: "module",
      domain: "ui",
      intent: "short",
      complexity: { scope_score: 1 },
    };
    const detail = resolveSwarmTargetDetail("discover", manifest, {
      swarm_min_agents: { discover: 4 },
    });
    expect(detail.target).toBeGreaterThanOrEqual(4);
    expect(detail.phase_class).toBe("scope_driven");
  });

  it("applies remediate-app check_swarm command override minimum", () => {
    const manifest = {
      command: "remediate-app",
      verb: "fix",
      complexity: { scope_score: 0 },
    };
    const detail = resolveSwarmTargetDetail("check_swarm", manifest, {
      swarm_min_agents: { check_swarm: 3 },
    });
    expect(detail.target).toBeGreaterThanOrEqual(7);
  });

  it("writes target_agents onto manifest", () => {
    const manifest = {
      command: "create-module",
      verb: "create",
      complexity: { scope_score: 2 },
    };
    applySwarmTargetsToManifest(manifest, ["discover", "plan"], {
      swarm_min_agents: { discover: 4, plan: 2 },
    });
    expect(manifest.swarm.target_agents.discover).toBeGreaterThanOrEqual(4);
    expect(manifest.swarm.target_agents.plan).toBe(2);
  });
});

describe("resolve-swarm-waves", () => {
  it("returns single wave for small targets", () => {
    expect(resolveSwarmWaves(4).waves).toEqual([4]);
  });

  it("splits large targets into multiple waves", () => {
    const result = resolveSwarmWaves(20, { perAgentMax: 0.08 });
    expect(result.waves.reduce((a, b) => a + b, 0)).toBe(20);
    expect(result.waves.length).toBeGreaterThan(1);
  });
});

describe("bootstrap scope score", () => {
  beforeEach(() => resetSwarmSizingCache());

  it("scores intent and verb signals", () => {
    const sizing = loadSwarmSizing({});
    const low = computeBootstrapScopeScore(
      { intent: "fix bug", verb: "create", object: "module", domain: "ui" },
      sizing,
    );
    expect(low.score).toBeGreaterThanOrEqual(0);

    const high = computeBootstrapScopeScore(
      {
        intent: Array.from({ length: 250 }, (_, i) => `token${i}`).join(" "),
        verb: "fix",
        object: "module",
        domain: null,
      },
      sizing,
    );
    expect(high.score).toBeGreaterThan(low.score);
  });
});
