import { describe, it, expect } from "vitest";
import path from "path";
import {
  loadGraphSwarmConfig,
  resolveAgentSpecsForPhase,
  resolveSwarmSkillId,
  loadPhasesConfig,
} from "../src/run-engine/swarm-agent-specs.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const AAAC_ROOT = path.join(REPO_ROOT, ".cursor/aaac");

describe("swarm-agent-specs", () => {
  it("loads skill agents from graph.yaml", () => {
    const { skillAgents } = loadGraphSwarmConfig(AAAC_ROOT);
    expect(skillAgents.check).toEqual([
      "discovery-inventory",
      "discovery-ssot",
      "check-capability-trace",
    ]);
  });

  it("resolves check discover specs from graph", () => {
    const phasesConfig = loadPhasesConfig(AAAC_ROOT);
    const skillId = resolveSwarmSkillId(
      "discover",
      { verb: "check", command: "check-architecture" },
      phasesConfig,
    );
    expect(skillId).toBe("check");

    const specs = resolveAgentSpecsForPhase({
      aaacRoot: AAAC_ROOT,
      phase: "discover",
      manifest: { verb: "check", command: "check-architecture" },
      count: 3,
    });
    expect(specs.map((s) => s.id)).toEqual([
      "discovery-inventory",
      "discovery-ssot",
      "check-capability-trace",
    ]);
    expect(specs[0]?.cursorPath).toBe(".cursor/agents/discovery-inventory.md");
  });

  it("resolves mutating discover specs from discovery skill", () => {
    const specs = resolveAgentSpecsForPhase({
      aaacRoot: AAAC_ROOT,
      phase: "discover",
      manifest: { verb: "update", command: "update-module" },
      count: 4,
    });
    expect(specs.length).toBeGreaterThanOrEqual(3);
    expect(specs[0]?.id).toBe("discovery-inventory");
  });
});
