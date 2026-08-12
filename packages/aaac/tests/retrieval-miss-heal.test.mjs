import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { emptyRepoGraph, upsertNode, nodeIdForPath } from "../src/run-engine/experience/repo-graph.mjs";
import { buildTaskDocument } from "../src/run-engine/experience/task-document.mjs";
import { normalizeRetrievalHints } from "../src/run-engine/experience/retrieve-repo.mjs";
import { learnFromRetrievalMisses } from "../src/run-engine/experience/repo-learn.mjs";
import { normalizeRetrievalMiss } from "../src/run-engine/retrieval-miss.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("normalizeRetrievalMiss", () => {
  it("requires sought", () => {
    expect(normalizeRetrievalMiss({}).ok).toBe(false);
  });

  it("normalizes reason and confidence", () => {
    const r = normalizeRetrievalMiss({
      sought: "MemoryGraphVisualizer",
      reason: "not_in_focus",
      confidence: "high",
    });
    expect(r.ok).toBe(true);
    expect(r.miss.sought).toBe("MemoryGraphVisualizer");
    expect(r.miss.reason).toBe("not_in_focus");
  });
});

describe("normalizeRetrievalHints + buildTaskDocument", () => {
  it("includes sought lines in task document", () => {
    const hints = normalizeRetrievalHints({
      sought_terms: ["token refresh"],
      resolved_paths: ["apps/foo/auth.ts"],
    });
    expect(hints.paths).toContain("apps/foo/auth.ts");
    expect(hints.sought).toContain("token refresh");
    const { text } = buildTaskDocument(
      { verb: "review", object: "auth", intent: "check refresh", phase: "plan" },
      { paths: hints.paths, sought: hints.sought, recentFailures: hints.recentFailures },
    );
    expect(text).toMatch(/sought: token refresh/);
    expect(text).toMatch(/paths: apps\/foo\/auth\.ts/);
  });
});

describe("processRetrievalMisses (workspace-rooted)", () => {
  let tmpRoot;
  let prevWorkspace;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-miss-heal-"));
    prevWorkspace = process.env.AAAC_WORKSPACE_ROOT;
    process.env.AAAC_WORKSPACE_ROOT = tmpRoot;
    delete process.env.AAAC_AUTHORIZE_FALLBACK;

    const aaac = path.join(tmpRoot, ".cursor", "aaac");
    fs.mkdirSync(path.join(aaac, "state", "runs"), { recursive: true });
    fs.writeFileSync(
      path.join(aaac, "runtime-registry.json"),
      JSON.stringify({ commands: {}, phases: {} }),
    );
    fs.writeFileSync(
      path.join(aaac, "enforcement.json"),
      JSON.stringify({ edit_phases: ["execute"], swarm_min_agents: {} }),
    );
  });

  afterEach(() => {
    if (prevWorkspace === undefined) delete process.env.AAAC_WORKSPACE_ROOT;
    else process.env.AAAC_WORKSPACE_ROOT = prevWorkspace;
    delete process.env.AAAC_AUTHORIZE_FALLBACK;
    vi.resetModules();
  });

  async function loadMissApi() {
    vi.resetModules();
    return import("../src/run-engine/retrieval-miss.mjs");
  }

  function writeRunSkeleton(runId) {
    const dir = path.join(tmpRoot, ".cursor", "aaac", "state", "runs", runId);
    const artifacts = path.join(dir, "artifacts");
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "run.json"),
      JSON.stringify(
        {
          run_id: runId,
          command: "/review component",
          verb: "review",
          object: "component",
          intent: "review vector graph UI",
          phase: "discover",
          status: "active",
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(artifacts, "phase_context.json"),
      JSON.stringify(
        {
          experience: {
            repo_memory: {
              focus_paths: ["apps/agentic-os/src/unrelated.ts"],
            },
          },
          retrieval_hints: null,
          authorized_fallback: null,
        },
        null,
        2,
      ),
    );
    return { dir, artifacts };
  }

  it("expands unprocessed misses into retrieval_heal.json", async () => {
    const runId = "run_test_heal_1";
    const { artifacts } = writeRunSkeleton(runId);
    const api = await loadMissApi();
    api.recordRetrievalMiss(runId, {
      sought: "MemoryGraphVisualizer",
      reason: "not_in_focus",
    });
    const result = api.processRetrievalMisses(runId);
    expect(result.ok).toBe(true);
    expect(result.processed).toBe(1);
    expect(["expand", "expand_hints", "authorize_fallback"]).toContain(result.action);

    const heal = JSON.parse(
      fs.readFileSync(path.join(artifacts, "retrieval_heal.json"), "utf8"),
    );
    expect(heal.sought_terms).toContain("MemoryGraphVisualizer");
    expect(heal.miss_count).toBe(1);

    const store = JSON.parse(
      fs.readFileSync(path.join(artifacts, "retrieval_misses.json"), "utf8"),
    );
    expect(store.misses[0].processed_at).toBeTruthy();
  });

  it("authorizes fallback when authorize option is set", async () => {
    const runId = "run_test_auth_1";
    writeRunSkeleton(runId);
    const api = await loadMissApi();
    api.recordRetrievalMiss(runId, {
      sought: "zzzz-no-such-symbol-xyz",
      reason: "not_in_focus",
    });
    const result = api.processRetrievalMisses(runId, { authorize: true });
    expect(result.action).toBe("authorize_fallback");
    expect(result.fallback?.enabled).toBe(true);
  });

  it("is noop when all misses already processed", async () => {
    const runId = "run_test_noop";
    writeRunSkeleton(runId);
    const api = await loadMissApi();
    api.recordRetrievalMiss(runId, { sought: "x", reason: "other" });
    api.processRetrievalMisses(runId, { authorize: true });
    const second = api.processRetrievalMisses(runId);
    expect(second.processed).toBe(0);
    expect(second.action).toBe("noop");
  });

  it("writes authorized_fallback onto phase_context", async () => {
    const runId = "run_auth_fb";
    writeRunSkeleton(runId);
    const api = await loadMissApi();
    const fb = api.authorizeFallback(runId, {
      paths: ["apps/foo/a.ts"],
      tools: ["Grep"],
      max_searches: 2,
    });
    expect(fb.enabled).toBe(true);
    const pc = JSON.parse(
      fs.readFileSync(
        path.join(tmpRoot, ".cursor", "aaac", "state", "runs", runId, "artifacts", "phase_context.json"),
        "utf8",
      ),
    );
    expect(pc.authorized_fallback.enabled).toBe(true);
  });
});

describe("learnFromRetrievalMisses", () => {
  it("skips when quality not ok", () => {
    const graph = emptyRepoGraph();
    const out = learnFromRetrievalMisses(graph, {
      trajectory: { quality: { ok: false } },
      manifest: { object: "component" },
      artifactsDir: null,
    });
    expect(out.skipped[0].reason).toBe("quality_not_ok");
  });

  it("learns verified miss→paths into graph tags", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-miss-learn-"));
    const artifacts = path.join(tmp, "artifacts");
    fs.mkdirSync(artifacts, { recursive: true });
    const target = "apps/agentic-os/src/MemoryGraphVisualizer.tsx";
    fs.writeFileSync(
      path.join(artifacts, "retrieval_misses.json"),
      JSON.stringify({
        version: 1,
        misses: [{ sought: "MemoryGraphVisualizer", reason: "not_in_focus" }],
      }),
    );
    fs.writeFileSync(
      path.join(artifacts, "retrieval_heal.json"),
      JSON.stringify({
        sought_terms: ["MemoryGraphVisualizer"],
        resolved_paths: [target],
        by_sought: { MemoryGraphVisualizer: [target] },
        action: "expand",
      }),
    );
    fs.writeFileSync(
      path.join(artifacts, "discover_brief.yaml"),
      `confirmed:\n  - ${target}\nnew_findings: []\n`,
    );

    const graph = emptyRepoGraph();
    upsertNode(graph, {
      id: nodeIdForPath(target),
      kind: "file",
      path: target,
      summary: "Memory graph visualizer",
      tags: [],
    });

    const out = learnFromRetrievalMisses(graph, {
      trajectory: { quality: { ok: true }, paths_touched: [target] },
      manifest: {
        run_id: "run_learn",
        object: "component",
        intent: "review memory graph",
        command: "/review",
      },
      artifactsDir: artifacts,
    });

    expect(out.learned.length).toBe(1);
    expect(out.learned[0].paths).toContain(target);
    const node = graph.nodes[nodeIdForPath(target)];
    expect(node.tags).toContain("retrieval_alias");
    expect(String(node.trigger)).toMatch(/MemoryGraphVisualizer/);
  });

  it("skips unconfirmed resolutions", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-miss-skip-"));
    const artifacts = path.join(tmp, "artifacts");
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(
      path.join(artifacts, "retrieval_misses.json"),
      JSON.stringify({
        misses: [{ sought: "AuthToken", reason: "not_in_focus" }],
      }),
    );
    fs.writeFileSync(
      path.join(artifacts, "retrieval_heal.json"),
      JSON.stringify({
        sought_terms: ["AuthToken"],
        resolved_paths: ["apps/wrong/path.ts"],
        by_sought: { AuthToken: ["apps/wrong/path.ts"] },
      }),
    );
    fs.writeFileSync(
      path.join(artifacts, "discover_brief.yaml"),
      `confirmed:\n  - apps/other/ok.ts\n`,
    );

    const graph = emptyRepoGraph();
    const out = learnFromRetrievalMisses(graph, {
      trajectory: { quality: { ok: true } },
      manifest: { object: "auth" },
      artifactsDir: artifacts,
    });
    expect(out.learned.length).toBe(0);
    expect(out.skipped.some((s) => s.reason === "unconfirmed")).toBe(true);
  });
});
