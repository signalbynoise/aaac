import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

describe("resolveRunId + cli-latest sidecar", () => {
  let tmpRoot;
  let prevWorkspace;
  let prevRun;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-runid-"));
    prevWorkspace = process.env.AAAC_WORKSPACE_ROOT;
    prevRun = process.env.AAAC_RUN_ID;
    process.env.AAAC_WORKSPACE_ROOT = tmpRoot;
    delete process.env.AAAC_RUN_ID;
    delete process.env.AAAC_SESSION_ID;
    fs.mkdirSync(path.join(tmpRoot, ".cursor/aaac/state/active-runs"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpRoot, ".cursor/aaac/runtime-registry.json"),
      JSON.stringify({ commands: {}, phases: {} }),
    );
    fs.writeFileSync(
      path.join(tmpRoot, ".cursor/aaac/enforcement.json"),
      JSON.stringify({ edit_phases: ["execute"] }),
    );
  });

  afterEach(() => {
    if (prevWorkspace === undefined) delete process.env.AAAC_WORKSPACE_ROOT;
    else process.env.AAAC_WORKSPACE_ROOT = prevWorkspace;
    if (prevRun === undefined) delete process.env.AAAC_RUN_ID;
    else process.env.AAAC_RUN_ID = prevRun;
    vi.resetModules();
  });

  it("finds the sidecar without hook env", async () => {
    vi.resetModules();
    const api = await import("../src/run-engine/resolve-run-id.mjs");
    api.writeCliLatestSidecar({
      run_id: "run_from_sidecar",
      session_id: "sess-1",
      agent_index: 2,
      phase: "discover",
    });
    const resolved = api.resolveRunId({}, {});
    expect(resolved.runId).toBe("run_from_sidecar");
    expect(resolved.source).toBe("sidecar");
  });

  it("prefers AAAC_RUN_ID over the sidecar", async () => {
    vi.resetModules();
    const api = await import("../src/run-engine/resolve-run-id.mjs");
    api.writeCliLatestSidecar({ run_id: "run_sidecar" });
    const resolved = api.resolveRunId({}, { AAAC_RUN_ID: "run_env" });
    expect(resolved.runId).toBe("run_env");
    expect(resolved.source).toBe("env");
  });

  it("writeCliLatestSidecarAt writes under an explicit workspace", async () => {
    vi.resetModules();
    const { writeCliLatestSidecarAt } = await import(
      "../src/run-engine/resolve-run-id.mjs"
    );
    writeCliLatestSidecarAt(tmpRoot, { run_id: "run_explicit", phase: "plan" });
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(tmpRoot, ".cursor/aaac/state/active-runs/cli-latest.json"),
        "utf8",
      ),
    );
    expect(raw.run_id).toBe("run_explicit");
    expect(raw.phase).toBe("plan");
  });
});
