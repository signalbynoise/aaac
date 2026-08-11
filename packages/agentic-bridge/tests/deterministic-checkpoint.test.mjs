import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { synthesizePhaseCheckpointDeterministic } from "../src/deterministic-checkpoint.mjs";

describe("deterministic checkpoint", () => {
  let root;
  let runId;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "det-ckpt-"));
    runId = "run_test_det_ckpt";
    const art = path.join(root, ".cursor", "aaac", "state", "runs", runId, "artifacts");
    fs.mkdirSync(art, { recursive: true });
    fs.writeFileSync(
      path.join(art, "discover_agent_1.md"),
      `# discover_agent_1\n\n## Findings\n\n- Memory graph UI lives under repo-memory-* domain modules and packages/ui MemoryGraphVisualizer.\n\n## Evidence\n\n| Claim | Evidence |\n|---|---|\n| Browser machine | apps/agentic-os/src/shared/domain/repo-memory-browser-machine.ts:22-30 |\n\n## Confirmed / Stale / New findings\n\n### Confirmed\n- apps/agentic-os/src/shared/domain/repo-memory-graph.ts\n\n### New findings\n- packages/ui/src/agentic-os/MemoryGraphVisualizer.tsx\n`,
    );
    fs.writeFileSync(
      path.join(art, "discover_agent_2.md"),
      `# discover_agent_2\n\n## Findings\n\n- Boundaries: UI package is presentational; domain owns lenses.\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes discover_brief.yaml with answer: without LLM", () => {
    const result = synthesizePhaseCheckpointDeterministic({
      workspaceRoot: root,
      runId,
      phase: "discover",
      manifest: {
        command: "review-domain",
        verb: "review",
        domain: "vector",
        intent: "graph UI",
      },
      swarmAgentCount: 2,
      missing: ["artifacts/discover_brief.yaml", "artifacts/discovery-brief.md"],
    });
    expect(result.ok).toBe(true);
    const brief = fs.readFileSync(
      path.join(root, ".cursor/aaac/state/runs", runId, "artifacts/discover_brief.yaml"),
      "utf8",
    );
    expect(brief).toMatch(/^answer:/m);
    expect(brief).toMatch(/evidence:/);
    const md = fs.readFileSync(
      path.join(root, ".cursor/aaac/state/runs", runId, "artifacts/discovery-brief.md"),
      "utf8",
    );
    expect(md).toMatch(/Discovery brief/);
  });
});
