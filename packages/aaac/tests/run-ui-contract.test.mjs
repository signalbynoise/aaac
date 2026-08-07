import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeRunManifestView } from "../../../apps/agentic-os/src/shared/domain/run-manifest-sanitize.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const RUN_SCHEMA = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, "packages/aaac/templates/cursor/aaac/run/schema.json"),
    "utf8",
  ),
);

function runView(overrides = {}) {
  return {
    run_id: "run_ui_contract",
    phase: "discover",
    status: "running",
    log: [],
    swarm: {
      phase: "discover",
      agents: [],
      expected_agent_specs: [],
    },
    ...overrides,
  };
}

describe("AAAC run UI contract", () => {
  it("preserves a sealed semantic Role summary at the 180-character boundary", () => {
    const summary = (
      "Preserve this complete semantic Role summary through the UI contract while keeping ownership clear and all phase outcomes understandable to readers without exposing technical details " +
      "safely"
    ).slice(0, 180);
    expect(summary).toHaveLength(180);

    const sanitized = sanitizeRunManifestView(runView({
      swarm: {
        phase: "discover",
        expected_agent_specs: [],
        agents: [{
          phase: "discover",
          index: 1,
          completed_at: "2026-07-20T08:00:00.000Z",
          summary,
        }],
      },
    }));

    expect(sanitized?.swarm?.agents?.[0]?.summary).toBe(summary);
  });

  it("accepts finalized exact-agent aggregate provenance", () => {
    const sanitized = sanitizeRunManifestView(runView({
      metrics: {
        total_tokens: 800,
        token_source: "agent_aggregate",
      },
    }));

    expect(sanitized?.metrics?.token_source).toBe("agent_aggregate");
    expect(sanitized?.metrics?.total_tokens).toBe(800);
  });

  it("accepts exact Cursor CLI agent provenance", () => {
    const sanitized = sanitizeRunManifestView(runView({
      swarm: {
        phase: "discover",
        expected_agent_specs: [],
        agents: [{
          phase: "discover",
          index: 1,
          tokens: 800,
          token_source: "cursor_cli_usage",
        }],
      },
    }));

    expect(sanitized?.swarm?.agents?.[0]?.token_source).toBe("cursor_cli_usage");
    expect(sanitized?.swarm?.agents?.[0]?.tokens).toBe(800);
  });

  it("documents exact token-source provenance in the run schema", () => {
    expect(RUN_SCHEMA.run.swarm_agent_entry.token_source).toContain(
      "cursor_cli_usage",
    );
    expect(RUN_SCHEMA.run.metrics.token_source).toContain("agent_aggregate");
    expect(RUN_SCHEMA.run.metrics.token_source).not.toContain("phase_aggregate");
  });
});
