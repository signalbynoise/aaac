import { describe, expect, it } from "vitest";
import {
  applyAgentComplete,
  parseMetricFromDetail,
  durationMsBetween,
  computePhaseDurationMs,
  findAgentArrayIndexBySubagentId,
} from "../src/run-engine/swarm-telemetry.mjs";
import { buildPhaseRows, buildAgentRows } from "../src/run-engine/persist-run.mjs";

function baseManifest(overrides = {}) {
  return {
    run_id: "run_test_telemetry",
    phase: "discover",
    phase_kind: "work",
    created_at: "2026-06-26T10:00:00.000Z",
    log: [
      { at: "2026-06-26T10:00:00.000Z", phase: "discover", event: "phase_start" },
    ],
    swarm: { task_launches_this_phase: 1, phase: "discover", agents: [] },
    ...overrides,
  };
}

describe("swarm-telemetry", () => {
  it("applyAgentComplete rolls up phase_metrics tokens and context max", () => {
    const manifest = baseManifest({
      swarm: {
        task_launches_this_phase: 2,
        phase: "discover",
        agents: [
          {
            index: 1,
            phase: "discover",
            at: "2026-06-26T10:00:01.000Z",
            started_at: "2026-06-26T10:00:01.000Z",
          },
          {
            index: 2,
            phase: "discover",
            at: "2026-06-26T10:00:02.000Z",
            started_at: "2026-06-26T10:00:02.000Z",
          },
        ],
      },
    });

    applyAgentComplete(manifest, {
      agentIndex: 0,
      phase: "discover",
      detail: "tokens=100 context=10",
      completedAt: "2026-06-26T10:01:00.000Z",
    });
    applyAgentComplete(manifest, {
      agentIndex: 1,
      phase: "discover",
      detail: "tokens=50 context=25",
      completedAt: "2026-06-26T10:02:00.000Z",
    });

    expect(manifest.phase_metrics.discover.tokens).toBe(150);
    expect(manifest.phase_metrics.discover.context).toBe(25);
    expect(manifest.swarm.agents[0].duration_ms).toBe(59000);
  });

  it("parseMetricFromDetail reads score as context fallback", () => {
    expect(parseMetricFromDetail("tokens=42 score=3.5", "tokens")).toBe(42);
    expect(parseMetricFromDetail("tokens=42 score=3.5", "score")).toBe(3.5);
  });

  it("computePhaseDurationMs uses phase_start log timestamp", () => {
    const manifest = baseManifest();
    const ms = computePhaseDurationMs(manifest, "discover", "2026-06-26T10:05:00.000Z");
    expect(ms).toBe(300000);
  });

  it("durationMsBetween returns null for invalid range", () => {
    expect(durationMsBetween(null, "2026-06-26T10:00:00.000Z")).toBeNull();
  });

  describe("findAgentArrayIndexBySubagentId", () => {
    it("returns array index when subagent_id matches agent in phase", () => {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 2,
          phase: "discover",
          agents: [
            { index: 1, phase: "discover", subagent_id: "sub-aaa" },
            { index: 2, phase: "discover", subagent_id: "sub-bbb" },
          ],
        },
      });

      expect(findAgentArrayIndexBySubagentId(manifest, "discover", "sub-aaa")).toBe(0);
      expect(findAgentArrayIndexBySubagentId(manifest, "discover", "sub-bbb")).toBe(1);
    });

    it("returns null when subagent_id is missing or not found", () => {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [{ index: 1, phase: "discover", subagent_id: "sub-aaa" }],
        },
      });

      expect(findAgentArrayIndexBySubagentId(manifest, "discover", null)).toBeNull();
      expect(findAgentArrayIndexBySubagentId(manifest, "discover", "")).toBeNull();
      expect(findAgentArrayIndexBySubagentId(manifest, "discover", "sub-missing")).toBeNull();
    });

    it("does not match agents in a different phase", () => {
      const manifest = baseManifest({
        phase: "plan",
        swarm: {
          task_launches_this_phase: 2,
          phase: "plan",
          agents: [
            { index: 1, phase: "discover", subagent_id: "sub-discover" },
            { index: 1, phase: "plan", subagent_id: "sub-plan" },
          ],
        },
      });

      expect(findAgentArrayIndexBySubagentId(manifest, "plan", "sub-discover")).toBeNull();
      expect(findAgentArrayIndexBySubagentId(manifest, "plan", "sub-plan")).toBe(1);
    });
  });

  it("applyAgentComplete with phase-local index does not overwrite prior-phase slot", () => {
    const manifest = baseManifest({
      swarm: {
        task_launches_this_phase: 1,
        phase: "plan",
        agents: [
          {
            index: 1,
            phase: "discover",
            at: "2026-06-26T10:00:01.000Z",
            started_at: "2026-06-26T10:00:01.000Z",
            description: "discover swarm agent 1/4",
            completed_at: "2026-06-26T10:01:00.000Z",
          },
          {
            index: 1,
            phase: "plan",
            at: "2026-06-26T10:05:00.000Z",
            started_at: "2026-06-26T10:05:00.000Z",
            description: "plan agent",
          },
        ],
      },
    });

    applyAgentComplete(manifest, {
      agentIndex: 0,
      phase: "plan",
      detail: "tokens=50 context=5",
      completedAt: "2026-06-26T10:06:00.000Z",
    });

    expect(manifest.swarm.agents[0].phase).toBe("discover");
    expect(manifest.swarm.agents[1].phase).toBe("plan");
    expect(manifest.swarm.agents[1].tokens).toBe(50);
  });
});

describe("persist-run telemetry rows", () => {
  it("buildPhaseRows includes tokens and duration_ms", () => {
    const rows = buildPhaseRows({
      run_id: "run_x",
      context: {
        phases: {
          discover: {
            artifact_bytes: 100,
            tokens: 200,
            duration_ms: 5000,
            evidence_lines_trimmed: 2,
          },
        },
      },
      phase_metrics: { discover: { context: 12.5 } },
    });
    expect(rows[0].tokens).toBe(200);
    expect(rows[0].duration_ms).toBe(5000);
    expect(rows[0].evidence_lines_trimmed).toBe(2);
    expect(rows[0].context_score).toBe(12.5);
  });

  it("buildAgentRows maps swarm agents and swarm_history", () => {
    const rows = buildAgentRows({
      run_id: "run_x",
      swarm: {
        agents: [
          {
            index: 1,
            phase: "discover",
            tokens: 10,
            context: 1.2,
            at: "2026-06-26T10:00:00.000Z",
            completed_at: "2026-06-26T10:01:00.000Z",
            duration_ms: 60000,
          },
        ],
      },
      swarm_history: {
        validate: {
          agents: [{ index: 1, phase: "validate", tokens: 5, context: 0.5 }],
        },
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].phase).toBe("discover");
    expect(rows[1].phase).toBe("validate");
  });
});
