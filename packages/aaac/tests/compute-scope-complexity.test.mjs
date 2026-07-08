import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  seedRun,
  cleanupRun,
  writeArtifact,
  nextRunId,
  runManifestPath,
} from "./fixtures/run-state.mjs";
import { uniqueConversationId } from "./fixtures/hook-payloads.mjs";
import { createModuleManifest } from "./fixtures/sample-manifests.mjs";
import { REPO_ROOT } from "./fixtures/paths.mjs";

const COMPUTE_SCOPE = path.join(
  REPO_ROOT,
  ".cursor/aaac/scripts/run-engine/compute-scope-complexity.mjs",
);

function runComputeScope(runId, source) {
  return spawnSync(process.execPath, [COMPUTE_SCOPE, "--run-id", runId, "--source", source], {
    encoding: "utf8",
  });
}

describe("compute-scope-complexity", () => {
  const runs = [];

  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it("writes bootstrap scope artifact on init manifest", () => {
    const conversationId = uniqueConversationId("scope-bootstrap");
    const runId = nextRunId("scope-bootstrap");
    seedRun(createModuleManifest("discover", runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    const result = runComputeScope(runId, "bootstrap");
    expect(result.status).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), "utf8"));
    expect(manifest.complexity?.scope_score).toBeTypeOf("number");
    expect(fs.existsSync(path.join(REPO_ROOT, ".cursor/aaac/state/runs", runId, "artifacts/scope_complexity.yaml"))).toBe(true);
  });

  it("refines scope score from discover_brief scope_signals", () => {
    const conversationId = uniqueConversationId("scope-discover");
    const runId = nextRunId("scope-discover");
    seedRun(createModuleManifest("discover", runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    writeArtifact(
      runId,
      "artifacts/discover_brief.yaml",
      `answer: partial
summary: test
scope_signals:
  files_in_scope: 20
  cross_domain: true
`,
    );

    const result = runComputeScope(runId, "discover");
    expect(result.status).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), "utf8"));
    expect(manifest.complexity?.scope_score).toBeGreaterThan(2);
  });
});
