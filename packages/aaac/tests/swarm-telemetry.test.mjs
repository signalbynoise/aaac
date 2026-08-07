import { describe, expect, it } from "vitest";
import {
  applyAgentComplete,
  applyAgentSemanticProgress,
  applyAgentToolProgress,
  archivePhaseSwarm,
  bumpAgentFileCounters,
  classifyToolFileMutation,
  formatSealedLaymanSummary,
  parseMetricFromDetail,
  durationMsBetween,
  computePhaseDurationMs,
  findAgentArrayIndexBySubagentId,
  formatAgentMetricsDetail,
  formatHookProgressSummary,
  normalizeSubagentId,
  estimateUsageFromCharCount,
} from "../src/run-engine/swarm-telemetry.mjs";
import {
  extractRoleInitialSummary,
  validateCurrentStep,
  validateFinalSummary,
  validateInitialSummary,
  validateSealedSummary,
} from "../src/run-engine/agent-progress-contract.mjs";
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
});

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

describe("swarm-telemetry", () => {

  describe("formatHookProgressSummary", () => {
    it("accepts only explicit UpdateCurrentStep semantic progress", () => {
      expect(
        formatHookProgressSummary({
          tool_name: "UpdateCurrentStep",
          tool_input: {
            current_step: "Reviewing module boundaries",
          },
        }),
      ).toBe("Reviewing module boundaries");
      expect(
        formatHookProgressSummary({
          tool_name: "Read",
          tool_input: {
            path: "apps/agentic-os/src/main.ts",
            current_step: "Reading main entry",
          },
        }),
      ).toBeNull();
    });

    it("rejects technical current steps instead of narrating tool activity", () => {
      expect(
        formatHookProgressSummary({
          tool_name: "UpdateCurrentStep",
          tool_input: {
            current_step: "Running pnpm test",
          },
        }),
      ).toBeNull();
    });
  });

  it("generic semantic validators reject technical and sensitive shapes", () => {
    const unsafe = [
      "Inspecting /Users/example/private/config",
      "Running node scripts/check.mjs",
      "Reviewing tokens=1200 context=40",
      "Opening package.json for details",
      '{"secret":"value"}',
      "Checking https://example.test/private",
    ];
    for (const value of unsafe) {
      expect(validateCurrentStep(value), value).toBeNull();
      expect(validateInitialSummary(value), value).toBeNull();
      expect(validateFinalSummary(value), value).toBeNull();
    }
  });

  describe("formatAgentMetricsDetail", () => {
    it("includes tokens= when only tokens is set (partial metrics)", () => {
      expect(formatAgentMetricsDetail({ tokens: 42000, context: null })).toBe("tokens=42000");
      expect(formatAgentMetricsDetail({ tokens: 500 })).toBe("tokens=500");
    });

    it("includes context= when only context is set", () => {
      expect(formatAgentMetricsDetail({ tokens: null, context: 12.5 })).toBe("context=12.50");
      expect(formatAgentMetricsDetail({ context: 3 })).toBe("context=3.00");
    });

    it("joins both fields when present", () => {
      expect(formatAgentMetricsDetail({ tokens: 100, context: 1.25 })).toBe(
        "tokens=100 context=1.25",
      );
    });

    it("returns empty string when both metrics are absent", () => {
      expect(formatAgentMetricsDetail({})).toBe("");
      expect(formatAgentMetricsDetail({ tokens: null, context: null })).toBe("");
      expect(formatAgentMetricsDetail(null)).toBe("");
    });
  });
});

it.each([
  "Working on the implementation",
  "Working through some code",
  "Looking into an issue",
  "Currently checking this",
  "Creating a component",
  "Editing the files",
  "Fixing that",
  "Handling the request",
  "Implementing a change",
  "Inspecting the codebase",
  "Reviewing an artifact",
  "Running the tests",
  "Testing something",
  "Updating the module",
  "Using a tool",
  "Writing the work",
])("rejects vague implementation activity grammar: %s", (value) => {
  expect(validateCurrentStep(value)).toBeNull();
  expect(validateInitialSummary(value)).toBeNull();
  expect(validateFinalSummary(value)).toBeNull();
});

it("accepts specific layman activity with a concrete outcome", () => {
  const activity = "Checking retry summaries use only the newest phase attempt";
  expect(validateCurrentStep(activity)).toBe(activity);
  expect(validateInitialSummary(activity)).toBe(activity);
  expect(validateFinalSummary(activity)).toBe(activity);
});

describe("swarm-telemetry", () => {

  it("applyAgentComplete_never_invents_chars4_as_display_ssot", () => {
    const detailWithoutTokens =
      "Completed explore pass over packages/ui/src/agentic-os/phase-timeline.ts and related helpers";
    const inventEstimate = estimateUsageFromCharCount(detailWithoutTokens.length).tokens;

    const manifest = baseManifest({
      swarm: {
        task_launches_this_phase: 1,
        phase: "discover",
        agents: [
          {
            index: 1,
            phase: "discover",
            at: "2026-06-26T10:00:01.000Z",
            started_at: "2026-06-26T10:00:01.000Z",
          },
        ],
      },
    });

    applyAgentComplete(manifest, {
      agentIndex: 0,
      phase: "discover",
      detail: detailWithoutTokens,
      completedAt: "2026-06-26T10:01:00.000Z",
    });

    expect(inventEstimate).toBeGreaterThan(1);
    expect(manifest.swarm.agents[0].tokens).toBeNull();
    expect(manifest.swarm.agents[0].context).toBeNull();
    expect(manifest.swarm.agents[0].token_source).toBe("unavailable");
    expect(manifest.swarm.agents[0].tokens).not.toBe(inventEstimate);
  });
});

describe("swarm-telemetry", () => {

  it("conversation_metrics_do_not_suppress_agent_seal", () => {
    const detailWithoutTokens =
      "Completed explore pass over packages/ui/src/agentic-os/phase-timeline.ts and related helpers";

    const manifest = baseManifest({
      metrics: {
        conversation_tokens: 42_000,
        context_usage_percent: 33.5,
      },
      swarm: {
        task_launches_this_phase: 1,
        phase: "discover",
        agents: [
          {
            index: 1,
            phase: "discover",
            subagent_id: "sub-seal",
            at: "2026-06-26T10:00:01.000Z",
            started_at: "2026-06-26T10:00:01.000Z",
          },
        ],
      },
    });

    applyAgentComplete(manifest, {
      agentIndex: 0,
      subagentId: "sub-seal",
      phase: "discover",
      detail: detailWithoutTokens,
      completedAt: "2026-06-26T10:01:00.000Z",
    });

    // AgentLifecycle seal is orthogonal to conversation chrome — completed_at wins.
    expect(manifest.swarm.agents[0].completed_at).toBe("2026-06-26T10:01:00.000Z");
    expect(manifest.swarm.agents[0].tokens).toBeNull();
    expect(manifest.swarm.agents[0].context).toBeNull();
    expect(manifest.swarm.agents[0].token_source).toBe("unavailable");
    expect(manifest.metrics.conversation_tokens).toBe(42_000);
    expect(manifest.metrics.context_usage_percent).toBe(33.5);
  });

  it("normalizeSubagentId collapses embedded newlines for seal match", () => {
    expect(normalizeSubagentId("sub-abc\n")).toBe("sub-abc");
    expect(normalizeSubagentId("  sub-xyz\n\n")).toBe("sub-xyz");
    expect(normalizeSubagentId("")).toBeNull();
    expect(normalizeSubagentId(null)).toBeNull();
  });
});

describe("swarm-telemetry", () => {

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

    it("classifyToolFileMutation maps Read/Grep/Glob/SemanticSearch/Write/StrReplace/Delete", () => {
      expect(classifyToolFileMutation("Read")).toBe("read");
      expect(classifyToolFileMutation("Grep")).toBe("read");
      expect(classifyToolFileMutation("Glob")).toBe("read");
      expect(classifyToolFileMutation("SemanticSearch")).toBe("read");
      expect(classifyToolFileMutation("Write")).toBe("written");
      expect(classifyToolFileMutation("StrReplace")).toBe("edited");
      expect(classifyToolFileMutation("Delete")).toBe("edited");
      expect(classifyToolFileMutation("Shell")).toBeNull();
      expect(classifyToolFileMutation("Task")).toBeNull();
    });

    it("bumpAgentFileCounters increments the matching bucket", () => {
      const agent = { files_read: 1, files_written: 0, files_edited: 2 };
      expect(bumpAgentFileCounters(agent, "read").files_read).toBe(2);
      expect(bumpAgentFileCounters(agent, "written").files_written).toBe(1);
      expect(bumpAgentFileCounters(agent, "edited").files_edited).toBe(3);
    });

    it("applyAgentComplete without prior files_* seals null + files_source unavailable (not 0)", () => {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              at: "2026-06-26T10:00:01.000Z",
              started_at: "2026-06-26T10:00:01.000Z",
            },
          ],
        },
      });

      applyAgentComplete(manifest, {
        agentIndex: 0,
        phase: "discover",
        detail: "tokens=10 context=1",
        completedAt: "2026-06-26T10:01:00.000Z",
      });

      const agent = manifest.swarm.agents[0];
      expect(agent.files_read).toBeNull();
      expect(agent.files_written).toBeNull();
      expect(agent.files_edited).toBeNull();
      expect(agent.files_source).toBe("unavailable");
      expect(agent.files_read).not.toBe(0);
      expect(agent.files_written).not.toBe(0);
      expect(agent.files_edited).not.toBe(0);
    });

    function verifyBridgeFileMetering() {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              origin: "agentic-os",
              at: "2026-06-26T10:00:01.000Z",
              started_at: "2026-06-26T10:00:01.000Z",
            },
          ],
        },
      });

      applyAgentToolProgress(manifest, {
        phase: "discover",
        agentIndex: 0,
        toolName: "Read",
        path: "docs/architecture.md",
        filesSource: "metered_bridge",
      });
      applyAgentToolProgress(manifest, {
        phase: "discover",
        agentIndex: 0,
        toolName: "Grep",
        filesSource: "metered_bridge",
      });
      applyAgentToolProgress(manifest, {
        phase: "discover",
        agentIndex: 0,
        toolName: "Write",
        path: "out.md",
        filesSource: "metered_bridge",
      });

      const agent = manifest.swarm.agents[0];
      expect(agent.files_source).toBe("metered_bridge");
      expect(agent.files_read).toBe(2);
      expect(agent.files_written).toBe(1);

      applyAgentComplete(manifest, {
        agentIndex: 0,
        phase: "discover",
        detail: "Findings",
        completedAt: "2026-06-26T10:01:00.000Z",
      });

      expect(manifest.swarm.agents[0].files_source).toBe("metered_bridge");
      expect(manifest.swarm.agents[0].files_read).toBe(2);
      expect(manifest.swarm.agents[0].files_written).toBe(1);
    }

    it("bridge applyAgentToolProgress with filesSource metered_bridge bumps files_read", verifyBridgeFileMetering);

    function verifyShellOnlyFileMetering() {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              subagent_id: "sub-shell",
              at: "2026-06-26T10:00:01.000Z",
              started_at: "2026-06-26T10:00:01.000Z",
            },
          ],
        },
      });

      applyAgentToolProgress(manifest, {
        phase: "discover",
        hook: {
          subagent_id: "sub-shell",
          tool_name: "Shell",
          tool_input: { command: "pnpm test", description: "Run unit tests" },
        },
      });

      const afterProgress = manifest.swarm.agents[0];
      expect(afterProgress.files_source).toBe("metered_hook");
      expect(afterProgress.files_read).toBe(0);
      expect(afterProgress.files_written).toBe(0);
      expect(afterProgress.files_edited).toBe(0);

      applyAgentComplete(manifest, {
        agentIndex: 0,
        subagentId: "sub-shell",
        phase: "discover",
        detail: "tokens=20 context=2",
        completedAt: "2026-06-26T10:01:00.000Z",
      });

      const sealed = manifest.swarm.agents[0];
      expect(sealed.files_source).toBe("metered_hook");
      expect(sealed.files_read).toBe(0);
      expect(sealed.files_written).toBe(0);
      expect(sealed.files_edited).toBe(0);
      expect(sealed.files_read).not.toBeNull();
    }

    it("Shell-only applyAgentToolProgress meters files_*=0; complete preserves 0 (not null)", verifyShellOnlyFileMetering);

    function verifyFileMeteringPreservesSemanticProgress() {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              subagent_id: "sub-rwe",
              last_progress: "Auditing card behavior",
              at: "2026-06-26T10:00:01.000Z",
              started_at: "2026-06-26T10:00:01.000Z",
            },
          ],
        },
      });

      applyAgentToolProgress(manifest, {
        phase: "discover",
        hook: {
          subagent_id: "sub-rwe",
          tool_name: "Read",
          tool_input: { path: "packages/ui/src/agentic-os/phase-timeline.ts" },
        },
      });
      applyAgentToolProgress(manifest, {
        phase: "discover",
        hook: {
          subagent_id: "sub-rwe",
          tool_name: "Write",
          tool_input: { path: "apps/agentic-os/tests/phase-timeline.test.ts" },
        },
      });
      applyAgentToolProgress(manifest, {
        phase: "discover",
        hook: {
          subagent_id: "sub-rwe",
          tool_name: "StrReplace",
          tool_input: { path: "packages/ui/src/agentic-os/OpenGridAgentCard.tsx" },
        },
      });

      const agent = manifest.swarm.agents[0];
      expect(agent.files_source).toBe("metered_hook");
      expect(agent.files_read).toBe(1);
      expect(agent.files_written).toBe(1);
      expect(agent.files_edited).toBe(1);
      expect(agent.last_progress).toBe("Auditing card behavior");

      applyAgentComplete(manifest, {
        agentIndex: 0,
        subagentId: "sub-rwe",
        phase: "discover",
        detail: "tokens=30 context=3",
        finalSummary: "Mapped file counters from hook meters.",
        completedAt: "2026-06-26T10:03:00.000Z",
      });

      const sealed = manifest.swarm.agents[0];
      expect(sealed.files_source).toBe("metered_hook");
      expect(sealed.files_read).toBe(1);
      expect(sealed.files_written).toBe(1);
      expect(sealed.files_edited).toBe(1);
    }

    it("applyAgentToolProgress meters files without changing semantic progress", verifyFileMeteringPreservesSemanticProgress);

    function verifySearchToolMeteringWithoutNarrative() {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              subagent_id: "sub-search",
              last_progress: "Mapping search coverage",
              at: "2026-06-26T10:00:01.000Z",
              started_at: "2026-06-26T10:00:01.000Z",
            },
          ],
        },
      });

      applyAgentToolProgress(manifest, {
        phase: "discover",
        hook: {
          subagent_id: "sub-search",
          tool_name: "Grep",
          tool_input: { pattern: "archivePhaseSwarm" },
        },
      });
      applyAgentToolProgress(manifest, {
        phase: "discover",
        hook: {
          subagent_id: "sub-search",
          tool_name: "Glob",
          tool_input: { glob_pattern: "**/*.test.ts" },
        },
      });
      applyAgentToolProgress(manifest, {
        phase: "discover",
        hook: {
          subagent_id: "sub-search",
          tool_name: "SemanticSearch",
          tool_input: { query: "where is resolveAgentMetrics" },
        },
      });

      const agent = manifest.swarm.agents[0];
      expect(agent.files_read).toBe(3);
      expect(agent.files_written ?? 0).toBe(0);
      expect(agent.files_edited ?? 0).toBe(0);
      expect(agent.last_progress).toBe("Mapping search coverage");
    }

    it("applyAgentToolProgress counts search tools without creating narrative", verifySearchToolMeteringWithoutNarrative);

    it("applyAgentSemanticProgress alone updates last_progress", () => {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              subagent_id: "sub-semantic",
              last_progress: "Reviewing assigned behavior",
            },
          ],
        },
      });

      applyAgentToolProgress(manifest, {
        phase: "discover",
        hook: {
          subagent_id: "sub-semantic",
          tool_name: "Read",
          tool_input: { path: "private-module.ts" },
        },
      });
      expect(manifest.swarm.agents[0].last_progress).toBe("Reviewing assigned behavior");

      const result = applyAgentSemanticProgress(manifest, {
        phase: "discover",
        subagentId: "sub-semantic",
        currentStep: "Checking lifecycle behavior",
      });
      expect(result.applied).toBe(true);
      expect(manifest.swarm.agents[0].last_progress).toBe("Checking lifecycle behavior");
    });

    it("applyAgentToolProgress does not overwrite last_progress after sealed summary", () => {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              subagent_id: "sub-sealed",
              summary: "Finished open-grid Agent Card fields.",
              completed_at: "2026-06-26T10:02:00.000Z",
              last_progress: "Reading phase-timeline.ts",
              files_read: 2,
            },
          ],
        },
      });

      const result = applyAgentToolProgress(manifest, {
        phase: "discover",
        hook: {
          subagent_id: "sub-sealed",
          tool_name: "Read",
          tool_input: { path: "packages/ui/src/agentic-os/agentic-os.css" },
        },
      });

      expect(result.sealed).toBe(true);
      expect(result.summary).toBeNull();
      expect(manifest.swarm.agents[0].last_progress).toBe("Reading phase-timeline.ts");
      expect(manifest.swarm.agents[0].files_read).toBe(3);
    });

    it("formatSealedLaymanSummary keeps at most two plain lines", () => {
      expect(
        formatSealedLaymanSummary(
          "Mapped open-grid model chip.\nShows R/W/E from agent SSOT.\nThird line must drop.",
        ),
      ).toBe("Mapped open-grid model chip.\nShows R/W/E from agent SSOT.");
      expect(formatSealedLaymanSummary("")).toBeNull();
      expect(formatSealedLaymanSummary("   \n\n")).toBeNull();
    });

    it("applyAgentComplete seals summary, preserves R/W/E, and never logs empty detail", () => {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              at: "2026-06-26T10:00:01.000Z",
              started_at: "2026-06-26T10:00:01.000Z",
              files_read: 4,
              files_written: 1,
              files_edited: 2,
              last_progress: "Reading phase-timeline.ts",
            },
          ],
        },
      });

      applyAgentComplete(manifest, {
        agentIndex: 0,
        phase: "discover",
        detail: "",
        finalSummary: "Mapped agent card fields from the source of truth.\nKept shimmer focus live.",
        completedAt: "2026-06-26T10:03:00.000Z",
      });

      const agent = manifest.swarm.agents[0];
      expect(agent.summary).toBe(
        "Mapped agent card fields from the source of truth. Kept shimmer focus live.",
      );
      expect(agent.files_read).toBe(4);
      expect(agent.files_written).toBe(1);
      expect(agent.files_edited).toBe(2);

      const completeLog = manifest.log.filter((entry) => entry.event === "agent_complete");
      expect(completeLog.at(-1)?.detail).toBeTruthy();
      expect(completeLog.at(-1)?.detail).not.toBe("");
    });

describe("swarm-telemetry", () => {

  describe("applyAgentComplete sealed summary + R/W/E persistence", () => {

    it("applyAgentComplete does not overwrite an already sealed summary", () => {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              at: "2026-06-26T10:00:01.000Z",
              started_at: "2026-06-26T10:00:01.000Z",
              summary: "Original sealed summary.",
              completed_at: "2026-06-26T10:01:00.000Z",
            },
          ],
        },
      });

      applyAgentComplete(manifest, {
        agentIndex: 0,
        phase: "discover",
        detail: "tokens=10 context=1",
        finalSummary: "Replacement that must not win.",
        completedAt: "2026-06-26T10:04:00.000Z",
      });

      expect(manifest.swarm.agents[0].summary).toBe("Original sealed summary.");
    });
  });
});

function verifyCompletionSummarySealing() {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 2,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              started_at: "2026-06-26T10:00:01.000Z",
              last_progress: "Checking lifecycle behavior",
            },
            {
              index: 2,
              phase: "discover",
              started_at: "2026-06-26T10:00:02.000Z",
              last_progress: "Reviewing fallback behavior",
            },
          ],
        },
      });

      applyAgentComplete(manifest, {
        agentIndex: 0,
        phase: "discover",
        detail: "tokens=900 context=4 stdout=private-output",
        finalSummary: "Verified semantic completion behavior.",
        completedAt: "2026-06-26T10:01:00.000Z",
      });
      applyAgentComplete(manifest, {
        agentIndex: 1,
        phase: "discover",
        detail: "tokens=800 context=3 output=technical",
        finalSummary: "tokens=800 context=3",
        completedAt: "2026-06-26T10:01:01.000Z",
      });

      expect(manifest.swarm.agents[0].summary).toBe(
        "Verified semantic completion behavior.",
      );
      expect(manifest.swarm.agents[1].summary).toBe(
        "Reviewing fallback behavior",
      );
      expect(manifest.swarm.agents.map((agent) => agent.summary).join(" ")).not.toMatch(
        /tokens=|stdout=|output=/,
      );
}

it("completion seals the valid final summary or last semantic progress only", verifyCompletionSummarySealing);

it("seals a 121–180 character Role-derived last_progress without final_summary", () => {
      const roleSummary = extractRoleInitialSummary(`
# Test author

## Role
Prove completion sealing preserves the validated role description when no explicit final summary is available, without exposing technical activity or file details.

## Constraints
Tests only.
`);
      expect(roleSummary).toBeTruthy();
      expect(roleSummary.length).toBeGreaterThan(120);
      expect(roleSummary.length).toBeLessThanOrEqual(180);
      expect(validateSealedSummary(roleSummary)).toBe(roleSummary);

      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              started_at: "2026-06-26T10:00:01.000Z",
              initial_summary: roleSummary,
              last_progress: roleSummary,
            },
          ],
        },
      });

      applyAgentComplete(manifest, {
        agentIndex: 0,
        phase: "discover",
        completedAt: "2026-06-26T10:01:00.000Z",
      });

      expect(manifest.swarm.agents[0].summary).toBe(roleSummary);
      expect(manifest.swarm.agents[0].completed_at).toBeTruthy();
});

it("rejects contaminated prior summary and last_progress during completion", () => {
      const manifest = baseManifest({
        swarm: {
          task_launches_this_phase: 1,
          phase: "discover",
          agents: [
            {
              index: 1,
              phase: "discover",
              started_at: "2026-06-26T10:00:01.000Z",
              summary: '{"status":"complete","tokens":900}',
              last_progress: "Reading packages/ui/src/agentic-os/phase-timeline.ts",
            },
          ],
        },
      });

      applyAgentComplete(manifest, {
        agentIndex: 0,
        phase: "discover",
        completedAt: "2026-06-26T10:01:00.000Z",
      });

      const sealed = manifest.swarm.agents[0];
      expect(sealed.completed_at).toBeTruthy();
      expect(sealed).not.toHaveProperty("summary");
      expect(JSON.stringify(sealed)).not.toMatch(/"status":"complete"|Reading packages\/ui/);
});

    function verifyMissingAgentSealBackfill() {
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
              last_progress: "Reviewing timeline behavior",
            },
            {
              index: 2,
              phase: "discover",
              at: "2026-06-26T10:00:02.000Z",
              started_at: "2026-06-26T10:00:02.000Z",
              completed_at: "2026-06-26T10:01:00.000Z",
              duration_ms: 58_000,
              summary: "Already sealed.",
            },
          ],
        },
      });

      archivePhaseSwarm(manifest, "discover");

      const backfilled = manifest.swarm.agents[0];
      expect(backfilled.completed_at).toBeTruthy();
      expect(typeof backfilled.completed_at).toBe("string");
      expect(backfilled.duration_ms).toBeGreaterThan(0);
      expect(backfilled.summary).toBe("Reviewing timeline behavior");

      const alreadySealed = manifest.swarm.agents[1];
      expect(alreadySealed.completed_at).toBe("2026-06-26T10:01:00.000Z");
      expect(alreadySealed.duration_ms).toBe(58_000);
      expect(alreadySealed.summary).toBe("Already sealed.");

      expect(manifest.swarm_history.discover.agents).toHaveLength(2);
      expect(manifest.swarm_history.discover.agents[0].completed_at).toBeTruthy();
      expect(manifest.swarm_history.discover.agents[0].duration_ms).toBeGreaterThan(0);
    }

    it("backfills completed_at and duration_ms for agents missing seals", verifyMissingAgentSealBackfill);

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
