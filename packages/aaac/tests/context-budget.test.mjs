import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import {
  capList,
  compactDiscoverBriefContent,
  loadContextBudget,
  validateDiscoverBriefContent,
  validateContextBudgetArtifacts,
  CONTEXT_BUDGET_PATH,
} from "../../../.cursor/aaac/scripts/run-engine/context-budget.mjs";
import { loadEnforcement } from "../../../.cursor/aaac/scripts/run-engine/lib.mjs";
import { resolveSwarmTarget } from "../src/run-engine/resolve-swarm-target.mjs";
import {
  seedRun,
  cleanupRun,
  writeArtifact,
  nextRunId,
} from "./fixtures/run-state.mjs";
import { checkModuleManifest } from "./fixtures/sample-manifests.mjs";
import { uniqueConversationId } from "./fixtures/hook-payloads.mjs";
import { advancePhase, recordTaskLaunch } from "./fixtures/run-engine-spawn.mjs";

describe("context-budget", () => {
  const runs = [];

  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it("loadContextBudget reads compaction caps from SSOT yaml", () => {
    expect(fs.existsSync(CONTEXT_BUDGET_PATH)).toBe(true);
    const budget = loadContextBudget();
    expect(budget.compaction.merge_findings_max).toBe(25);
    expect(budget.compaction.top_review_for_trace).toBe(25);
    expect(budget.handoff.check_discover).toBe("artifacts/discover_brief.yaml");
  });

  it("capList truncates to max length", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    expect(capList(items, 25)).toHaveLength(25);
    expect(capList(items, 25)[24]).toBe("item-24");
  });

  it("compactDiscoverBriefContent trims excess evidence list items", () => {
    const lines = ["answer: yes", "evidence:"];
    for (let i = 0; i < 12; i += 1) lines.push(`  - item ${i}`);
    const input = `${lines.join("\n")}\n`;
    const result = compactDiscoverBriefContent(input);
    expect(result.compacted).toBe(true);
    expect(result.removed).toBe(2);
    expect(validateDiscoverBriefContent(result.content).ok).toBe(true);
  });

  it("validateDiscoverBriefContent rejects missing answer field", () => {
    const result = validateDiscoverBriefContent("summary: partial\n");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/answer/i);
  });

  it("check verb discover advance requires discover_brief.yaml", async () => {
    const conversationId = uniqueConversationId("check-discover-brief");
    const runId = nextRunId("check-discover-brief");
    const manifest = checkModuleManifest("discover", runId, conversationId);
    const enforcement = loadEnforcement();
    const min =
      resolveSwarmTarget("discover", manifest, enforcement) ??
      enforcement.swarm_min_agents.check_swarm ??
      3;
    manifest.swarm = { task_launches_this_phase: min, phase: "discover" };
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const missing = await advancePhase(runId, "discover");
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/discover_brief\.yaml/);

    writeArtifact(
      runId,
      "artifacts/discover_brief.yaml",
      "answer: partial\nsummary: test\n",
    );
    writeArtifact(runId, "artifacts/discovery-brief.md", "# Discover\n");
    const ok = await advancePhase(runId, "discover");
    expect(ok.code).toBe(0);
    expect(ok.json?.phase).toBe("validate");
  });

  it("validateContextBudgetArtifacts passes for valid discover brief", () => {
    const conversationId = uniqueConversationId("ctx-budget-valid");
    const runId = nextRunId("ctx-budget-valid");
    const manifest = checkModuleManifest("discover", runId, conversationId);
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    writeArtifact(
      runId,
      "artifacts/discover_brief.yaml",
      "answer: yes\nsummary: ok\n",
    );

    const enforcement = loadEnforcement();
    const result = validateContextBudgetArtifacts(
      runId,
      "discover",
      manifest,
      enforcement,
    );
    expect(result.ok).toBe(true);
  });
});
