import { describe, expect, it } from "vitest";
import {
  extractSealedStageMetrics,
  validateStageSummaryEntry,
} from "../src/run-engine/write-stage-summary.mjs";

const TECHNICAL_LAYMAN_CASES = [
  [
    "structured semantic JSON",
    '{"status":"complete","summary":"Validated architecture boundaries","agent_index":2}',
  ],
  [
    "structured JSON array",
    '["Validated architecture boundaries","Reviewed dependency flow"]',
  ],
  [
    "technical payload",
    "tokens=1200 context=18 duration_ms=4500 stdout=/Users/example/private-output",
  ],
  [
    "repository path",
    "Reviewed packages/aaac/src/run-engine/write-stage-summary.mjs for boundary behavior",
  ],
  [
    "npm scoped package reference",
    "Reviewed @example/package before sealing the stage summary",
  ],
  [
    "ellipsis-truncated repository path",
    "Reviewed modules/example/src/... before sealing the stage summary",
  ],
  [
    "snake_case internal token",
    "Confirmed internal_state remained isolated before sealing the stage summary",
  ],
  [
    "relative filesystem path",
    "Reviewed ./packages/aaac before sealing the stage summary",
  ],
  [
    "shell command",
    "Ran pnpm test to confirm all stage summary behavior",
  ],
  [
    "structured key-value payload",
    "status: complete after validating architecture boundaries",
  ],
  [
    "inline backticks",
    "Validated `stageSummary` while preserving the approved architecture boundaries",
  ],
  [
    "bracket expression",
    "Validated stages[phase] while preserving the approved architecture boundaries",
  ],
  [
    "call expression",
    "Validated refreshSummary() while preserving the approved architecture boundaries",
  ],
  [
    "member expression",
    "Validated manifest.swarm while preserving the approved architecture boundaries",
  ],
  [
    "camel-case code-like identifier",
    "Validated sourceFingerprint while preserving the approved architecture boundaries",
  ],
];

function registerValidationTests() {
  it("metricsAreValid accepts string cost_method / cost_quality provenance", () => {
    const ok = validateStageSummaryEntry({
      layman:
        "Stage sealed from artifact findings with metered agents only.",
      source_artifacts: ["artifacts/plan.yaml"],
      metrics: {
        agent_count: 2,
        files_explored: 4,
        duration_ms: 1200,
        avg_context_percent: 12.5,
        avg_tokens: 500,
        estimated_cost_usd: 0.01,
        cost_method: "blended_total",
        cost_quality: "blended",
      },
    });
    expect(ok.ok).toBe(true);

    const badType = validateStageSummaryEntry({
      layman:
        "Stage sealed from artifact findings with metered agents only.",
      source_artifacts: ["artifacts/plan.yaml"],
      metrics: {
        agent_count: 2,
        cost_method: 123,
        cost_quality: "blended",
      },
    });
    expect(badType.ok).toBe(false);
    expect(badType.reason).toMatch(/cost_method is not a string/);
  });

  it.each(TECHNICAL_LAYMAN_CASES)(
    "rejects %s as layman stage summary content",
    (_label, layman) => {
      const result = validateStageSummaryEntry({
        layman,
        source_artifacts: ["artifacts/plan.yaml"],
        metrics: {
          agent_count: 2,
        },
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/VALIDATE_FAIL/);
    },
  );

  it("preserves apostrophes in ordinary layman prose", () => {
    const result = validateStageSummaryEntry({
      layman:
        "The team's review confirmed the architecture remains clear and predictable.",
      source_artifacts: ["artifacts/plan.yaml"],
      metrics: { agent_count: 2 },
    });

    expect(result.ok).toBe(true);
  });
}

function registerMeteredMetricsTests() {
  it("stage avg_tokens comes from sealed agent meters only", () => {
    const manifest = {
      phase_metrics: {
        discover: { tokens: 999_999, context: 90, duration_ms: 5000 },
      },
      swarm: {
        task_launches_this_phase: 2,
        phase: "discover",
        agents: [
          {
            phase: "discover",
            tokens: 100,
            context: 10,
            files_source: "metered_hook",
            files_read: 2,
            files_written: 0,
            files_edited: 1,
          },
          {
            phase: "discover",
            tokens: 300,
            context: 20,
            files_source: "metered_hook",
            files_read: 1,
            files_written: 1,
            files_edited: 0,
          },
        ],
      },
    };

    const metrics = extractSealedStageMetrics(manifest, "discover");
    expect(metrics.avg_tokens).toBe(200);
    expect(metrics.avg_context_percent).toBe(15);
    expect(metrics.agent_count).toBe(2);
    expect(metrics.files_explored).toBe(5);
    expect(metrics.duration_ms).toBe(5000);
    // Must not invent avg from phase_metrics.tokens alone when agents differ.
    expect(metrics.avg_tokens).not.toBe(999_999);
  });

  it("metered agents with files_source metered_hook sum files_explored correctly", () => {
    const manifest = {
      phase_metrics: {
        discover: { duration_ms: 3000 },
      },
      swarm: {
        task_launches_this_phase: 2,
        phase: "discover",
        agents: [
          {
            phase: "discover",
            files_source: "metered_hook",
            files_read: 0,
            files_written: 0,
            files_edited: 0,
          },
          {
            phase: "discover",
            files_source: "metered_hook",
            files_read: 3,
            files_written: 1,
            files_edited: 2,
          },
        ],
      },
    };

    const metrics = extractSealedStageMetrics(manifest, "discover");
    // Shell-metered zero + file-tool meters must both count (0+6 = 6).
    expect(metrics.files_explored).toBe(6);
    expect(metrics.files_explored).not.toBeNull();
  });

  it("sealed token components roll up and price via input_output", () => {
    const manifest = {
      swarm: {
        task_launches_this_phase: 2,
        phase: "discover",
        agents: [
          {
            phase: "discover",
            model: "cursor-grok-4.5-medium-fast",
            tokens: 100_000,
            input_tokens: 20_000,
            output_tokens: 500,
            cache_read_tokens: 79_500,
            cache_write_tokens: 0,
            token_source: "cursor_cli_usage",
            context: 10,
          },
          {
            phase: "discover",
            model: "cursor-grok-4.5-medium-fast",
            tokens: 50_000,
            input_tokens: 10_000,
            output_tokens: 200,
            cache_read_tokens: 39_800,
            cache_write_tokens: 0,
            token_source: "cursor_cli_usage",
            context: 5,
          },
        ],
      },
    };

    const metrics = extractSealedStageMetrics(manifest, "discover");
    expect(metrics.input_tokens).toBe(30_000);
    expect(metrics.output_tokens).toBe(700);
    expect(metrics.cache_read_tokens).toBe(119_300);
    expect(metrics.cache_write_tokens).toBe(0);
    expect(metrics.cost_method).toBe("input_output");
    expect(metrics.cost_quality).toBe("metered");
    expect(metrics.estimated_cost_usd).toBeCloseTo(
      (30_000 / 1e6) * 4 + (700 / 1e6) * 18 + (119_300 / 1e6) * 0.5,
      6,
    );
  });
}

function registerUnmeteredMetricsTests() {
  it("unmetered agents (files_source unavailable, null counters) yield files_explored null", () => {
    const manifest = {
      phase_metrics: {
        discover: { tokens: 50_000, context: 40, duration_ms: 8000 },
      },
      swarm: {
        task_launches_this_phase: 2,
        phase: "discover",
        agents: [
          {
            phase: "discover",
            tokens: null,
            context: null,
            token_source: "unavailable",
            files_source: "unavailable",
            files_read: null,
            files_written: null,
            files_edited: null,
            completed_at: "2026-06-26T10:01:00.000Z",
          },
          {
            phase: "discover",
            tokens: null,
            context: null,
            token_source: "unavailable",
            files_source: "unavailable",
            files_read: null,
            files_written: null,
            files_edited: null,
            completed_at: "2026-06-26T10:02:00.000Z",
          },
        ],
      },
    };

    const metrics = extractSealedStageMetrics(manifest, "discover");
    expect(metrics.files_explored).toBeNull();
    expect(metrics.files_explored).not.toBe(0);
  });

  it("unmetered agents yield null avg_tokens — never invent from phase_metrics.tokens", () => {
    const manifest = {
      phase_metrics: {
        discover: { tokens: 50_000, context: 40, duration_ms: 8000 },
      },
      swarm: {
        task_launches_this_phase: 1,
        phase: "discover",
        agents: [
          {
            phase: "discover",
            tokens: null,
            context: null,
            token_source: "unavailable",
            completed_at: "2026-06-26T10:01:00.000Z",
          },
        ],
      },
    };

    const metrics = extractSealedStageMetrics(manifest, "discover");
    // Token SSOT is sealed agent meters only — phase_metrics.tokens must not invent avg.
    expect(metrics.avg_tokens).toBeNull();
    expect(metrics.avg_tokens).not.toBe(50_000);
    expect(metrics.estimated_cost_usd).toBeNull();
    expect(metrics.cost_method).toBeNull();
    expect(metrics.cost_quality).toBeNull();
  });
}

describe("write-stage-summary validation", registerValidationTests);
describe("write-stage-summary metered metrics", registerMeteredMetricsTests);
describe("write-stage-summary unmetered metrics", registerUnmeteredMetricsTests);
