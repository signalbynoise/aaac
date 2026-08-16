import { describe, expect, it, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import {
  materializeWorkerCapsule,
  addGrantToCapsule,
  collectCapsuleOutput,
  shouldUseWorkerCapsule,
  writeCapsuleMcpConfig,
  CAPSULE_OUTPUT_REL,
} from "../src/run-engine/worker-capsule.mjs";
import {
  buildMacosSeatbeltProfile,
  probeSandboxIsolation,
  resolveSandboxLauncher,
  siblingDenyRoots,
} from "../src/run-engine/worker-sandbox.mjs";
import {
  classifySought,
  CONTEXT_EVENTS,
  isLearnableTaxonomy,
  isSourceContextPath,
} from "../src/run-engine/context-taxonomy.mjs";
import {
  resolveContextRequest,
  readGrantedContext,
} from "../src/run-engine/request-context.mjs";
import { createContextBroker } from "../src/run-engine/context-broker.mjs";
import { learnFromRetrievalMisses } from "../src/run-engine/experience/repo-learn.mjs";
import { emptyRepoGraph } from "../src/run-engine/experience/repo-graph.mjs";

const temps = [];
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return d;
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function writeWorkspace() {
  const root = tmpDir("aaac-capsule-ws-");
  const src = "apps/foo/repo-memory.ts";
  const ops = ".cursor/aaac/state/runs/run_x/artifacts/phase_context.json";
  const policy = ".cursor/policies/minimal-complexity.md";
  fs.mkdirSync(path.join(root, "apps/foo"), { recursive: true });
  fs.mkdirSync(path.join(root, path.dirname(ops)), { recursive: true });
  fs.mkdirSync(path.join(root, ".cursor/policies"), { recursive: true });
  fs.writeFileSync(path.join(root, src), "export function getRepoGraph() {}\n");
  fs.writeFileSync(path.join(root, "apps/foo/other.ts"), "export const other = 1;\n");
  fs.writeFileSync(path.join(root, ops), "{}");
  fs.writeFileSync(path.join(root, policy), "# policy\n");
  return { root, src, ops, policy };
}

describe("shouldUseWorkerCapsule", () => {
  it("enables for check swarm and env override", () => {
    expect(shouldUseWorkerCapsule({ verb: "check" }, "swarm")).toBe(true);
    expect(shouldUseWorkerCapsule({ verb: "check" }, "checkpoint")).toBe(false);
    expect(shouldUseWorkerCapsule({ verb: "fix" }, "swarm")).toBe(false);
  });
});

describe("materializeWorkerCapsule", () => {
  it("copies SOURCE grants only, never symlinks, omits ops/policy", () => {
    const { root, src, ops, policy } = writeWorkspace();
    const link = "apps/foo/linked.ts";
    fs.symlinkSync(path.join(root, src), path.join(root, link));
    const { capsuleDir, copied, skipped } = materializeWorkerCapsule({
      workspaceRoot: root,
      runId: "run_cap",
      agentIndex: 0,
      phaseContext: {
        experience: {
          repo_memory: {
            focus_paths: [src, ops, policy, link, ".cursor/aaac/state"],
          },
        },
      },
      manifest: { verb: "check", command: "/check-architecture" },
      phase: "discover",
    });
    expect(copied).toEqual([src]);
    expect(skipped.some((s) => s.path === ops)).toBe(true);
    expect(skipped.some((s) => s.path === policy)).toBe(true);
    expect(fs.existsSync(path.join(capsuleDir, src))).toBe(true);
    expect(fs.lstatSync(path.join(capsuleDir, src)).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(capsuleDir, ops))).toBe(false);
    expect(fs.existsSync(path.join(capsuleDir, "RUN.md"))).toBe(true);
    expect(fs.existsSync(path.join(capsuleDir, ".aaac/grants.json"))).toBe(true);
  });

  it("collects OUTPUT.md into run artifacts", () => {
    const { root, src } = writeWorkspace();
    const { capsuleDir } = materializeWorkerCapsule({
      workspaceRoot: root,
      runId: "run_out",
      phaseContext: { experience: { repo_memory: { focus_paths: [src] } } },
      manifest: { verb: "check" },
      phase: "discover",
    });
    fs.writeFileSync(path.join(capsuleDir, CAPSULE_OUTPUT_REL), "# findings\n");
    const collected = collectCapsuleOutput({
      capsuleDir,
      workspaceRoot: root,
      runId: "run_out",
      phase: "discover",
      agentIndex: 0,
    });
    expect(collected.ok).toBe(true);
    expect(fs.readFileSync(collected.dest, "utf8")).toMatch(/findings/);
  });
});

describe("taxonomy", () => {
  it("classifies ops, dirs, prose, and source", () => {
    expect(classifySought(".cursor/aaac/state/active-runs")).toBe(
      CONTEXT_EVENTS.OPS_CONTEXT_REQUEST,
    );
    expect(classifySought("apps/foo")).toBe(CONTEXT_EVENTS.DISCOVERY_ATTEMPT);
    expect(classifySought("IPC handler for getRepoGraph")).toBe(
      CONTEXT_EVENTS.CONCEPTUAL_REQUEST,
    );
    expect(classifySought("apps/foo/repo-memory.ts")).toBe(
      CONTEXT_EVENTS.TRUE_RETRIEVAL_MISS,
    );
    expect(classifySought("/Users/x/apps/foo/repo-memory.ts")).toBe(
      CONTEXT_EVENTS.PATH_ALIAS,
    );
    expect(isSourceContextPath(".cursor/policies/x.md")).toBe(false);
    expect(isLearnableTaxonomy(CONTEXT_EVENTS.DISCOVERY_ATTEMPT)).toBe(false);
    expect(isLearnableTaxonomy(CONTEXT_EVENTS.TRUE_RETRIEVAL_MISS)).toBe(true);
  });
});

describe("request_context resolver", () => {
  it("refuses a guessed path that retrieve does not accept", async () => {
    const { root, src } = writeWorkspace();
    const { capsuleDir } = materializeWorkerCapsule({
      workspaceRoot: root,
      runId: "run_req",
      phaseContext: { experience: { repo_memory: { focus_paths: [src] } } },
      manifest: { verb: "check" },
      phase: "discover",
    });
    const denied = await resolveContextRequest({
      workspaceRoot: root,
      runId: "run_req",
      manifest: { verb: "check", intent: "x", phase: "discover" },
      capsuleDir,
      need: "apps/foo/other.ts",
      retrieve: false,
    });
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe("NOT_GRANTED");
    expect(fs.existsSync(path.join(capsuleDir, "apps/foo/other.ts"))).toBe(false);
  });

  it("grants a basename/graph hit and read_context serves it", async () => {
    const { root, src } = writeWorkspace();
    const { capsuleDir } = materializeWorkerCapsule({
      workspaceRoot: root,
      runId: "run_hit",
      phaseContext: { experience: { repo_memory: { focus_paths: [src] } } },
      manifest: { verb: "check" },
      phase: "discover",
    });
    const added = addGrantToCapsule({
      workspaceRoot: root,
      capsuleDir,
      relPath: "apps/foo/other.ts",
    });
    expect(added.ok).toBe(true);
    const read = readGrantedContext({
      capsuleDir,
      relPath: "apps/foo/other.ts",
    });
    expect(read.status).toBe("IN_PACKET");
    expect(read.text).toMatch(/other/);
    const secret = readGrantedContext({
      capsuleDir,
      relPath: "apps/foo/does-not-exist.ts",
    });
    expect(secret.status).toBe("NOT_GRANTED");
    expect(secret.text).toBeNull();
  });
});

describe("context broker HTTP", () => {
  it("serves request_context and MCP initialize", async () => {
    const { root, src } = writeWorkspace();
    const { capsuleDir } = materializeWorkerCapsule({
      workspaceRoot: root,
      runId: "run_http",
      phaseContext: { experience: { repo_memory: { focus_paths: [src] } } },
      manifest: { verb: "check" },
      phase: "discover",
    });
    const broker = createContextBroker({
      workspaceRoot: root,
      runId: "run_http",
      manifest: { verb: "check" },
      capsuleDir,
    });
    const { url } = await broker.listen();
    writeCapsuleMcpConfig(capsuleDir, url);
    expect(fs.existsSync(path.join(capsuleDir, ".cursor/mcp.json"))).toBe(true);

    const health = await fetch(`${url}/health`).then((r) => r.json());
    expect(health.ok).toBe(true);

    const rpc = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    }).then((r) => r.json());
    expect(rpc.result.serverInfo.name).toBe("aaac-context");

    const denied = await fetch(`${url}/request_context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ need: ".cursor/aaac/state" }),
    }).then((r) => r.json());
    expect(denied.status).toBe("NOT_GRANTED");
    expect(denied.taxonomy).toBe(CONTEXT_EVENTS.OPS_CONTEXT_REQUEST);

    await broker.close();
    expect(http.globalAgent).toBeTruthy();
  });
});

describe("sandbox deny", () => {
  it("builds a profile that names the workspace deny and capsule allow", () => {
    const profile = buildMacosSeatbeltProfile({
      capsuleDir: "/tmp/capsule",
      workspaceRoot: "/tmp/workspace",
    });
    expect(profile).toMatch(/deny file-read\*/);
    expect(profile).toMatch(/regex #"/);
    expect(siblingDenyRoots("/tmp/workspace").length).toBeGreaterThan(0);
    expect(siblingDenyRoots("/tmp/workspace")).toContain("/tmp/workspace");
  });

  it.skipIf(process.platform !== "darwin")(
    "sandbox-exec denies a real-workspace absolute path",
    () => {
      const { root, src } = writeWorkspace();
      const { capsuleDir } = materializeWorkerCapsule({
        workspaceRoot: root,
        runId: "run_sbx",
        phaseContext: { experience: { repo_memory: { focus_paths: [src] } } },
        manifest: { verb: "check" },
        phase: "discover",
      });
      const launcher = resolveSandboxLauncher({ capsuleDir, workspaceRoot: root });
      const probe = probeSandboxIsolation({ launcher, workspaceRoot: root, capsuleDir });
      expect(probe.ok).toBe(true);
      expect(probe.deniedWorkspace).toBe(true);
      expect(probe.allowedCapsule).toBe(true);
    },
  );
});

describe("learn filter", () => {
  it("ignores discovery/ops/prose misses", () => {
    const artifacts = tmpDir("aaac-learn-");
    fs.writeFileSync(
      path.join(artifacts, "retrieval_misses.json"),
      JSON.stringify({
        misses: [
          { sought: ".cursor/aaac/state", reason: "not_in_focus", taxonomy: "DISCOVERY_ATTEMPT" },
          { sought: "IPC handler", reason: "not_in_focus", taxonomy: "CONCEPTUAL_REQUEST" },
          {
            sought: ".cursor/policies/minimal-complexity.md",
            reason: "not_in_focus",
            taxonomy: "PROCESS_CONTEXT_REQUEST",
          },
        ],
      }),
    );
    const out = learnFromRetrievalMisses(emptyRepoGraph(), {
      trajectory: { quality: { ok: true }, paths_touched: [] },
      manifest: { object: "architecture" },
      artifactsDir: artifacts,
    });
    expect(out.learned).toEqual([]);
    expect(out.skipped.every((s) => s.reason !== "empty_expand")).toBe(true);
  });
});
