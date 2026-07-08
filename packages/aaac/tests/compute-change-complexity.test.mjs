import { describe, it, expect, afterEach } from "vitest";
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

const COMPUTE_CHANGE = path.join(
  REPO_ROOT,
  ".cursor/aaac/scripts/run-engine/compute-change-complexity.mjs",
);

describe("compute-change-complexity", () => {
  const runs = [];

  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it("derives change score from plan.yaml complexity_score", () => {
    const conversationId = uniqueConversationId("change-plan");
    const runId = nextRunId("change-plan");
    seedRun(createModuleManifest("plan", runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    writeArtifact(
      runId,
      "artifacts/plan.yaml",
      `complexity_score: 6
tests_to_add: []
steps: []
paths_to_touch:
  - apps/website/foo.ts
  - apps/website/bar.ts
  - apps/website/baz.ts
  - packages/ui/widget.ts
`,
    );

    const result = spawnSync(
      process.execPath,
      [COMPUTE_CHANGE, "--run-id", runId, "--source", "plan"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), "utf8"));
    expect(manifest.complexity?.change_score).toBeGreaterThanOrEqual(6);
    expect(
      fs.existsSync(
        path.join(REPO_ROOT, ".cursor/aaac/state/runs", runId, "artifacts/change_complexity.yaml"),
      ),
    ).toBe(true);
  });
});
