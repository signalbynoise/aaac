import { describe, expect, it } from "vitest";
import {
  aggregateRunMetrics,
  finalizeRunMetrics,
} from "../src/run-engine/swarm-telemetry.mjs";

function baseManifest(overrides = {}) {
  return {
    run_id: "run_test_metrics_finalization",
    phase: "report",
    phase_kind: "work",
    created_at: "2026-06-26T10:00:00.000Z",
    updated_at: "2026-06-26T10:04:00.000Z",
    log: [],
    swarm: { task_launches_this_phase: 0, phase: "report", agents: [] },
    ...overrides,
  };
}

describe("finalizeRunMetrics", () => {
  it("is idempotent for completed_at (second call keeps first timestamp)", () => {
    const firstCompletedAt = "2026-06-26T10:05:00.000Z";
    const manifest = baseManifest();

    finalizeRunMetrics(manifest, { completedAt: firstCompletedAt });
    expect(manifest.completed_at).toBe(firstCompletedAt);

    finalizeRunMetrics(manifest, {
      completedAt: "2026-06-26T11:00:00.000Z",
    });
    expect(manifest.completed_at).toBe(firstCompletedAt);
  });

  it("sets token_source from context_source when conversation_tokens already set", () => {
    const manifest = baseManifest({
      completed_at: "2026-06-26T10:05:00.000Z",
      metrics: {
        conversation_tokens: 50_000,
        context_usage_percent: 25,
        context_window_size: 200_000,
        context_source: "cursor_hook",
      },
    });

    const result = finalizeRunMetrics(manifest);

    expect(result.ok).toBe(true);
    expect(manifest.metrics.conversation_tokens).toBe(50_000);
    expect(manifest.metrics.total_tokens).toBe(50_000);
    expect(manifest.metrics.token_source).toBe("cursor_hook");
    expect(manifest.metrics.context_source).toBe("cursor_hook");
  });

  it("does not present legacy phase rollups as exact token usage", () => {
    const manifest = baseManifest({
      completed_at: "2026-06-26T10:05:00.000Z",
      phase_metrics: {
        discover: { tokens: 100, duration_ms: 60_000 },
        plan: { tokens: 50, duration_ms: 30_000 },
      },
    });

    finalizeRunMetrics(manifest);

    expect(manifest.metrics.conversation_tokens).toBeNull();
    expect(manifest.metrics.token_source).toBe("unavailable");
    expect(manifest.metrics.total_tokens).toBeNull();
  });

  it("sets token_source unavailable and total_tokens null when nothing available", () => {
    const manifest = baseManifest({
      completed_at: "2026-06-26T10:05:00.000Z",
      phase_metrics: {
        discover: { duration_ms: 60_000 },
      },
    });

    finalizeRunMetrics(manifest);

    expect(manifest.metrics.token_source).toBe("unavailable");
    expect(manifest.metrics.total_tokens).toBeNull();
    expect(manifest.metrics.total_tokens).not.toBe(0);
    expect(manifest.metrics.conversation_tokens).toBeNull();
    expect(manifest.metrics.metered_agent_count).toBe(0);
    expect(manifest.metrics.avg_context_percent).toBeNull();
    expect(manifest.metrics.context_usage_percent).toBeNull();
  });

  it("seals exact aggregate fields from the newest metered agent attempts", () => {
    const manifest = baseManifest({
      completed_at: "2026-06-26T10:05:00.000Z",
      log: [
        { phase: "discover", event: "phase_start", at: "2026-06-26T10:03:00.000Z" },
      ],
      swarm_history: {
        discover: {
          agents: [
            {
              index: 1,
              phase: "discover",
              started_at: "2026-06-26T10:03:01.000Z",
              tokens: 300,
              context: 20,
              token_source: "cursor_cli_usage",
            },
            {
              index: 2,
              phase: "discover",
              started_at: "2026-06-26T10:03:02.000Z",
              tokens: 500,
              context: 40,
              token_source: "legacy_meter",
            },
          ],
        },
      },
    });

    finalizeRunMetrics(manifest);

    expect(manifest.metrics).toMatchObject({
      total_tokens: 800,
      token_source: "agent_aggregate",
      metered_agent_count: 2,
      avg_context_percent: 30,
      context_usage_percent: 30,
    });
  });

  it("computes duration_ms from created_at to completed_at", () => {
    const manifest = baseManifest({
      created_at: "2026-06-26T10:00:00.000Z",
      completed_at: "2026-06-26T10:05:00.000Z",
    });

    finalizeRunMetrics(manifest);

    expect(manifest.metrics.duration_ms).toBe(300_000);
    expect(manifest.metrics.completed_at).toBe("2026-06-26T10:05:00.000Z");
  });
});

describe("aggregateRunMetrics", () => {
  it("prefers conversation_tokens over phase sum for total_tokens", () => {
    const manifest = baseManifest({
      completed_at: "2026-06-26T10:05:00.000Z",
      phase_metrics: {
        discover: { tokens: 10 },
      },
      metrics: {
        conversation_tokens: 99_000,
        context_source: "cursor_hook",
      },
    });

    const metrics = aggregateRunMetrics(manifest);

    expect(metrics.total_tokens).toBe(99_000);
    expect(metrics.duration_ms).toBe(300_000);
    expect(metrics.phase_count).toBe(1);
  });

  it("returns null total_tokens when phase sum is zero and no conversation tokens", () => {
    const manifest = baseManifest({
      completed_at: "2026-06-26T10:05:00.000Z",
      phase_metrics: {},
    });

    const metrics = aggregateRunMetrics(manifest);

    expect(metrics.total_tokens).toBeNull();
  });

  it("sums exact latest-attempt agent usage and averages exact context", () => {
    const manifest = baseManifest({
      completed_at: "2026-06-26T10:05:00.000Z",
      log: [
        { phase: "discover", event: "phase_start", at: "2026-06-26T10:00:00.000Z" },
        { phase: "discover", event: "phase_start", at: "2026-06-26T10:03:00.000Z" },
      ],
      swarm: {
        task_launches_this_phase: 2,
        phase: "discover",
        agents: [
          {
            phase: "discover",
            subagent_id: "old-attempt",
            started_at: "2026-06-26T10:01:00.000Z",
            tokens: 9_999,
            context: 99,
          },
          {
            phase: "discover",
            subagent_id: "latest-a",
            started_at: "2026-06-26T10:03:01.000Z",
            tokens: 300,
            context: 20,
          },
          {
            phase: "discover",
            subagent_id: "latest-b",
            started_at: "2026-06-26T10:03:02.000Z",
            tokens: 500,
            context: 40,
          },
        ],
      },
      phase_metrics: {
        discover: { tokens: 10_000, duration_ms: 60_000 },
        discover_swarm_target: { target: 4 },
        report_swarm_target: { target: 2 },
      },
      metrics: {
        conversation_tokens: 50_000,
        context_source: "cursor_hook",
      },
    });

    const metrics = aggregateRunMetrics(manifest);

    expect(metrics.total_tokens).toBe(800);
    expect(metrics.metered_agent_count).toBe(2);
    expect(metrics.avg_context_percent).toBe(30);
    expect(metrics.context_usage_percent).toBe(30);
    expect(metrics.token_source).toBe("agent_aggregate");
    expect(metrics.phase_count).toBe(1);
  });
});

describe("finalizeRunMetrics via terminal unit manifests", () => {
  it("keeps cancelled legacy phase rollups unavailable without exact usage", () => {
    const manifest = baseManifest({
      status: "cancelled",
      blocked_reason: "Superseded by run_new",
      created_at: "2026-06-26T09:00:00.000Z",
      phase_metrics: {
        discover: { tokens: 40 },
      },
    });

    finalizeRunMetrics(manifest, {
      completedAt: "2026-06-26T09:30:00.000Z",
    });

    expect(manifest.completed_at).toBe("2026-06-26T09:30:00.000Z");
    expect(manifest.metrics.duration_ms).toBe(1_800_000);
    expect(manifest.metrics.token_source).toBe("unavailable");
    expect(manifest.metrics.total_tokens).toBeNull();
  });

  it("finalizes metrics for a failed (abandoned) terminal manifest with null tokens", () => {
    const manifest = baseManifest({
      status: "failed",
      blocked_reason: "Run abandoned after 60 minutes with no activity",
      created_at: "2026-06-26T08:00:00.000Z",
    });

    finalizeRunMetrics(manifest, {
      completedAt: "2026-06-26T09:00:00.000Z",
    });

    expect(manifest.completed_at).toBe("2026-06-26T09:00:00.000Z");
    expect(manifest.metrics.duration_ms).toBe(3_600_000);
    expect(manifest.metrics.token_source).toBe("unavailable");
    expect(manifest.metrics.total_tokens).toBeNull();
  });
});
