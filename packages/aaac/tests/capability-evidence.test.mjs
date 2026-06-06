import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolveCapabilitiesForObject,
  resolveCapabilitiesWithRuntime,
  evaluateCapabilityRuntimePolicy,
  extractRunEvidence,
  evaluateState,
  updateCapabilityFromEvidence,
  processRunEvidence,
  loadCapabilityStats,
  CAPABILITY_STATS_PATH,
} from "../../.cursor/aaac/scripts/run-engine/capability-evidence.mjs";
import { nextRunId, seedRun, cleanupRun, writeArtifact } from "./fixtures/run-state.mjs";
import { uniqueConversationId } from "./fixtures/hook-payloads.mjs";

describe("capability-evidence", () => {
  let statsBackup = null;

  beforeEach(() => {
    if (fs.existsSync(CAPABILITY_STATS_PATH)) {
      statsBackup = fs.readFileSync(CAPABILITY_STATS_PATH, "utf8");
    }
    fs.writeFileSync(
      CAPABILITY_STATS_PATH,
      `${JSON.stringify({ version: 1, updated_at: null, capabilities: {} }, null, 2)}\n`,
    );
  });

  afterEach(() => {
    if (statsBackup != null) {
      fs.writeFileSync(CAPABILITY_STATS_PATH, statsBackup);
    } else if (fs.existsSync(CAPABILITY_STATS_PATH)) {
      fs.unlinkSync(CAPABILITY_STATS_PATH);
    }
  });

  it("resolves module object to layer-boundaries capability", () => {
    const resolved = resolveCapabilitiesForObject("module", "update");
    expect(resolved["layer-boundaries"]).toBeDefined();
    expect(resolved["layer-boundaries"].providers.length).toBeGreaterThan(0);
  });

  it("extracts success and gate evidence from completed manifest", () => {
    const manifest = {
      run_id: "run_test",
      status: "completed",
      log: [
        { event: "gate_pass", phase: "validate" },
        { event: "gate_fail", phase: "discover", detail: "swarm incomplete" },
        { event: "gate_pass", phase: "validate" },
      ],
      command: "update-module",
      object: "module",
      verb: "update",
    };
    const evidence = extractRunEvidence(manifest, "/tmp/no-artifacts");
    expect(evidence.success).toBe(true);
    expect(evidence.gate_failures).toBe(1);
    expect(evidence.gate_passes).toBe(2);
  });

  it("promotes to validated after min invocations", () => {
    const store = { capabilities: {} };
    const evidence = {
      success: true,
      failure: false,
      rollback: false,
      gate_passes: 5,
      gate_failures: 0,
      fitness_score: 95,
      run_id: "run_1",
    };

    for (let i = 0; i < 10; i += 1) {
      updateCapabilityFromEvidence(store, "layer-boundaries", evidence);
    }

    expect(store.capabilities["layer-boundaries"].state).toBe("validated");
    expect(store.capabilities["layer-boundaries"].stats.invocations).toBe(10);
  });

  it("requires manual approval for canonical state", () => {
    const entry = {
      state: "trusted",
      stats: {
        invocations: 150,
        successes: 145,
        failures: 5,
        rollbacks: 0,
        gate_passes: 500,
        gate_failures: 2,
        avg_fitness_score: 96,
        fitness_samples: 10,
      },
      gate_history: { passed: 500, failed: 2 },
      history: { promoted: ["experimental", "validated", "trusted"] },
      overrides: null,
    };

    expect(evaluateState(entry)).toBe("trusted");
  });

  it("processRunEvidence aggregates stats for a completed run", () => {
    const conversationId = uniqueConversationId("cap-evidence");
    const runId = nextRunId("cap-evidence");
    const manifest = {
      run_id: runId,
      conversation_id: conversationId,
      command: "update-module",
      verb: "update",
      object: "module",
      status: "completed",
      capabilities_resolved: resolveCapabilitiesForObject("module", "update"),
      log: [{ event: "gate_pass", phase: "validate" }],
      gates: { stack: "pre_execute", results: { validate: "pass" } },
      created_at: "2026-06-06T12:00:00.000Z",
      updated_at: "2026-06-06T12:00:00.000Z",
    };

    seedRun(manifest, conversationId);
    writeArtifact(runId, "artifacts/fitness-functions.yaml", `score:
  layer_boundaries: pass
  minimal_complexity: pass
blocking_failures: []
`);

    const result = processRunEvidence(runId);
    expect(result.ok).toBe(true);
    expect(result.outcomes?.length).toBeGreaterThan(0);

    const stats = loadCapabilityStats();
    expect(stats.capabilities["layer-boundaries"].stats.invocations).toBe(1);
    expect(stats.capabilities["layer-boundaries"].stats.successes).toBe(1);

    cleanupRun(runId, conversationId);
  });

  it("requires approval for experimental capability on critical object", () => {
    const resolved = resolveCapabilitiesWithRuntime("module", "update");
    const policy = evaluateCapabilityRuntimePolicy(resolved, { object_maturity: "critical" });
    expect(policy.action).toBe("require_approval");
    expect(policy.reasons.some((r) => r.includes("layer-boundaries"))).toBe(true);
  });

  it("blocks execute for deprecated capability state", () => {
    fs.writeFileSync(
      CAPABILITY_STATS_PATH,
      `${JSON.stringify(
        {
          version: 1,
          capabilities: {
            "layer-boundaries": {
              state: "deprecated",
              stats: { invocations: 50, successes: 40, failures: 10, rollbacks: 0, gate_passes: 100, gate_failures: 5 },
              gate_history: { passed: 100, failed: 5 },
              history: { promoted: [] },
              overrides: null,
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    const resolved = resolveCapabilitiesWithRuntime("module", "update");
    const policy = evaluateCapabilityRuntimePolicy(resolved, { object_maturity: "critical" });
    expect(policy.action).toBe("block");
  });
});
