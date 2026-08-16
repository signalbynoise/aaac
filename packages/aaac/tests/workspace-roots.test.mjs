import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  findWorkspaceRootFrom,
  isPackagedModuleDir,
  resolveWorkspaceRoots,
  rootsFromRepo,
} from "../src/run-engine/workspace-roots.mjs";
import { runDir } from "../src/run-engine/lib.mjs";
import { recordRetrievalMiss } from "../src/run-engine/retrieval-miss.mjs";

function tmpWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-ws-roots-"));
  const enforcement = path.join(root, ".cursor", "aaac", "enforcement.json");
  fs.mkdirSync(path.dirname(enforcement), { recursive: true });
  fs.writeFileSync(enforcement, "{}\n");
  return root;
}

describe("isPackagedModuleDir", () => {
  it("detects npm and pnpm install paths", () => {
    expect(
      isPackagedModuleDir(
        "/Users/x/app/node_modules/@ludecker/aaac/src/run-engine",
      ),
    ).toBe(true);
    expect(
      isPackagedModuleDir(
        "/Users/x/app/node_modules/.pnpm/@ludecker+aaac@1.9.4/node_modules/@ludecker/aaac/src/run-engine",
      ),
    ).toBe(true);
    expect(
      isPackagedModuleDir("/Users/x/app/.cursor/aaac/scripts/run-engine"),
    ).toBe(false);
  });
});

describe("resolveWorkspaceRoots", () => {
  it("never uses a packaged module dir as the run store", () => {
    const project = tmpWorkspace();
    const packaged =
      "/Users/x/app/node_modules/.pnpm/@ludecker+aaac@1.9.4/node_modules/@ludecker/aaac/src/run-engine";
    const roots = resolveWorkspaceRoots({
      moduleDir: packaged,
      cwd: project,
      env: {},
    });
    expect(roots.repoRoot).toBe(path.resolve(project));
    expect(roots.runsRoot).toBe(
      path.join(project, ".cursor", "aaac", "state", "runs"),
    );
    expect(roots.runsRoot.includes(`${path.sep}node_modules${path.sep}`)).toBe(
      false,
    );
  });

  it("explicit workspaceRoot beats env and packaged moduleDir", () => {
    const project = tmpWorkspace();
    const other = tmpWorkspace();
    const roots = resolveWorkspaceRoots({
      moduleDir:
        "/Users/x/app/node_modules/@ludecker/aaac/src/run-engine",
      cwd: other,
      env: { AAAC_WORKSPACE_ROOT: other },
      workspaceRoot: project,
    });
    expect(roots.repoRoot).toBe(path.resolve(project));
  });

  it("walks cwd to the repo that owns enforcement.json", () => {
    const project = tmpWorkspace();
    const nested = path.join(project, "apps", "web");
    fs.mkdirSync(nested, { recursive: true });
    expect(findWorkspaceRootFrom(nested)).toBe(path.resolve(project));
  });
});

describe("runDir + recordRetrievalMiss", () => {
  it("re-resolves after AAAC_WORKSPACE_ROOT changes (not frozen at import)", () => {
    const project = tmpWorkspace();
    const prev = process.env.AAAC_WORKSPACE_ROOT;
    process.env.AAAC_WORKSPACE_ROOT = project;
    try {
      const runId = "run_live_root";
      expect(runDir(runId)).toBe(
        path.join(project, ".cursor", "aaac", "state", "runs", runId),
      );
      const recorded = recordRetrievalMiss(runId, {
        sought: "apps/foo.ts",
        reason: "not_in_focus",
      });
      expect(recorded.path.startsWith(project)).toBe(true);
      expect(recorded.path.includes(`${path.sep}node_modules${path.sep}`)).toBe(
        false,
      );
      expect(fs.existsSync(recorded.path)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.AAAC_WORKSPACE_ROOT;
      else process.env.AAAC_WORKSPACE_ROOT = prev;
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("writes misses to opts.workspaceRoot even when env points at a package tree", () => {
    const project = tmpWorkspace();
    const poison = path.join(os.tmpdir(), "aaac-poison-package");
    const prev = process.env.AAAC_WORKSPACE_ROOT;
    process.env.AAAC_WORKSPACE_ROOT = poison;
    try {
      const runId = "run_explicit_root";
      const recorded = recordRetrievalMiss(
        runId,
        { sought: "docs/architecture.md", reason: "not_in_focus" },
        { workspaceRoot: project },
      );
      expect(recorded.path).toBe(
        path.join(
          project,
          ".cursor",
          "aaac",
          "state",
          "runs",
          runId,
          "artifacts",
          "retrieval_misses.json",
        ),
      );
      expect(fs.existsSync(path.join(poison, ".cursor"))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.AAAC_WORKSPACE_ROOT;
      else process.env.AAAC_WORKSPACE_ROOT = prev;
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("rootsFromRepo", () => {
  it("places runs under .cursor/aaac/state/runs", () => {
    const roots = rootsFromRepo("/tmp/repo");
    expect(roots.runsRoot).toBe(
      path.resolve("/tmp/repo/.cursor/aaac/state/runs"),
    );
  });
});
