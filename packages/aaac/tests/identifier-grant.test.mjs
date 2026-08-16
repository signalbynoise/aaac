import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  identifierTokensFromSought,
  identifierMatchesNode,
  nodeMatchesSought,
} from "../src/run-engine/sought-paths.mjs";
import { resolvePathsForSought } from "../src/run-engine/retrieval-miss.mjs";
import {
  emptyRepoGraph,
  hashFile,
  loadRepoGraph,
  nodeIdForPath,
  saveRepoGraph,
  upsertNode,
} from "../src/run-engine/experience/repo-graph.mjs";
import { liveExperiencePaths } from "../src/run-engine/experience/paths.mjs";
import {
  addGrantToCapsule,
  materializeWorkerCapsule,
  readCapsuleGrants,
} from "../src/run-engine/worker-capsule.mjs";
import { resolveContextRequest } from "../src/run-engine/request-context.mjs";
import { CONTEXT_EVENTS } from "../src/run-engine/context-taxonomy.mjs";
import { confirmLearnCandidates } from "../src/run-engine/experience/granted-paths.mjs";
import { learnFromRetrievalMisses } from "../src/run-engine/experience/repo-learn.mjs";

const temps = [];
const envKeys = ["AAAC_WORKSPACE_ROOT"];
const prevEnv = {};

function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return d;
}

function writeRel(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function seedGraph(root, files) {
  const graph = emptyRepoGraph();
  for (const file of files) {
    upsertNode(graph, {
      id: nodeIdForPath(file.path),
      kind: "file",
      path: file.path,
      api: file.api ?? "",
      summary: file.summary ?? "",
      source_files: [file.path],
      source_hashes: { [file.path]: hashFile(path.join(root, file.path)) },
    });
  }
  saveRepoGraph(graph, root);
  return graph;
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  for (const key of envKeys) {
    if (Object.prototype.hasOwnProperty.call(prevEnv, key)) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
      delete prevEnv[key];
    }
  }
});

function snapshotEnv(key) {
  if (!Object.prototype.hasOwnProperty.call(prevEnv, key)) {
    prevEnv[key] = process.env[key];
  }
}

describe("identifierTokensFromSought", () => {
  it("keeps PascalCase, camelCase, and CONST_CASE tokens", () => {
    expect(identifierTokensFromSought("SurfaceMode type definition")).toEqual([
      "SurfaceMode",
    ]);
    expect(identifierTokensFromSought("ChromeToggleCluster composition")).toEqual([
      "ChromeToggleCluster",
    ]);
    expect(identifierTokensFromSought("invokeEdgeFunction implementation")).toEqual([
      "invokeEdgeFunction",
    ]);
    expect(identifierTokensFromSought("FOUR_LEVEL lunar dial")).toEqual(["FOUR_LEVEL"]);
  });

  it("drops taxonomy event names", () => {
    expect(identifierTokensFromSought("SOURCE_CONTEXT PACKET_CACHE")).toEqual([]);
  });
});

describe("identifierMatchesNode", () => {
  it("matches basename identifiers without splitting camelCase", () => {
    expect(
      identifierMatchesNode(
        "src/ui/ChromeToggleCluster.tsx",
        "",
        "ChromeToggleCluster composition",
      ),
    ).toBe(true);
  });

  it("matches exported api symbols whose basename is too short", () => {
    expect(
      identifierMatchesNode(
        "src/domain/celestial/types.ts",
        "SurfaceMode, OverlayKind",
        "SurfaceMode type definition",
      ),
    ).toBe(true);
    expect(
      identifierMatchesNode(
        "src/lib/edgeClient.ts",
        "invokeEdgeFunction",
        "invokeEdgeFunction implementation",
      ),
    ).toBe(true);
    expect(
      identifierMatchesNode(
        "src/domain/calendar/constants.ts",
        "FOUR_LEVEL, LUNAR_PHASE_DIAL",
        "FOUR_LEVEL lunar dial",
      ),
    ).toBe(true);
  });

  it("does not treat IPC/toast English as a types.ts hit", () => {
    expect(
      identifierMatchesNode(
        "src/hooks/useRepoMemoryToasts.ts",
        "useRepoMemoryToasts",
        "IPC/preload handlers for getRepoGraph, ensureRepoMemory, pollRepoMemoryEvents",
      ),
    ).toBe(false);
  });
});

describe("resolvePathsForSought identifiers", () => {
  it("maps 9367-style asks onto graph files", () => {
    const types = "src/domain/celestial/types.ts";
    const chrome = "src/ui/ChromeToggleCluster.tsx";
    const edge = "src/lib/edgeClient.ts";
    const constants = "src/domain/calendar/constants.ts";
    const graph = emptyRepoGraph();
    upsertNode(graph, {
      id: nodeIdForPath(types),
      kind: "file",
      path: types,
      api: "SurfaceMode, OverlayKind",
    });
    upsertNode(graph, {
      id: nodeIdForPath(chrome),
      kind: "file",
      path: chrome,
      api: "ChromeToggleCluster",
    });
    upsertNode(graph, {
      id: nodeIdForPath(edge),
      kind: "file",
      path: edge,
      api: "invokeEdgeFunction",
    });
    upsertNode(graph, {
      id: nodeIdForPath(constants),
      kind: "file",
      path: constants,
      api: "FOUR_LEVEL, LUNAR_PHASE_DIAL",
    });

    const surface = resolvePathsForSought(["SurfaceMode type definition"], { graph });
    expect(surface.paths).toContain(types);
    const cluster = resolvePathsForSought(["ChromeToggleCluster composition"], { graph });
    expect(cluster.paths).toContain(chrome);
    const invoke = resolvePathsForSought(["invokeEdgeFunction implementation"], { graph });
    expect(invoke.paths).toContain(edge);
    const four = resolvePathsForSought(["FOUR_LEVEL lunar dial"], { graph });
    expect(four.paths).toContain(constants);
  });

  it("does not grant a guessed path that is only on disk", () => {
    const root = tmpDir("aaac-ident-disk-");
    writeRel(root, "apps/foo/other.ts", "export const other = 1;\n");
    const out = resolvePathsForSought(["apps/foo/other.ts"], {
      workspaceRoot: root,
      graph: emptyRepoGraph(),
      allowExactDisk: false,
    });
    expect(out.paths).toEqual([]);
  });
});

describe("loadRepoGraph live workspaceRoot", () => {
  it("reads the override graph even when env points at another tree", () => {
    const project = tmpDir("aaac-ident-graph-");
    const poison = tmpDir("aaac-ident-poison-");
    writeRel(project, "src/ui/ChromeToggleCluster.tsx", "export function ChromeToggleCluster() {}\n");
    writeRel(poison, "src/ui/ChromeToggleCluster.tsx", "export function ChromeToggleCluster() {}\n");
    seedGraph(project, [
      { path: "src/ui/ChromeToggleCluster.tsx", api: "ChromeToggleCluster" },
    ]);
    seedGraph(poison, [
      { path: "src/ui/ChromeToggleCluster.tsx", api: "PoisonCluster" },
    ]);
    snapshotEnv("AAAC_WORKSPACE_ROOT");
    process.env.AAAC_WORKSPACE_ROOT = poison;
    const loaded = loadRepoGraph(project);
    expect(loaded.nodes[nodeIdForPath("src/ui/ChromeToggleCluster.tsx")].api).toBe(
      "ChromeToggleCluster",
    );
    expect(liveExperiencePaths(project).repoGraphPath).toBe(
      path.join(project, ".cursor/aaac/state/repo-graph.json"),
    );
    expect(liveExperiencePaths(project).repoGraphPath).not.toBe(
      liveExperiencePaths(poison).repoGraphPath,
    );
  });
});

describe("resolveContextRequest identifier grants", () => {
  function writeCalendarWorkspace() {
    const root = tmpDir("aaac-ident-ctx-");
    const types = "src/domain/celestial/types.ts";
    const chrome = "src/ui/ChromeToggleCluster.tsx";
    const arch = "docs/architecture.md";
    writeRel(root, types, "export type SurfaceMode = 'sky' | 'map';\n");
    writeRel(root, chrome, "export function ChromeToggleCluster() {}\n");
    writeRel(root, arch, "# architecture\n");
    writeRel(root, "apps/foo/other.ts", "export const other = 1;\n");
    seedGraph(root, [
      { path: types, api: "SurfaceMode, OverlayKind" },
      { path: chrome, api: "ChromeToggleCluster" },
      { path: arch, summary: "system modularity" },
    ]);
    return { root, types, chrome, arch };
  }

  it("grants the file that exports the named identifier", async () => {
    const { root, types, chrome } = writeCalendarWorkspace();
    const { capsuleDir } = materializeWorkerCapsule({
      workspaceRoot: root,
      runId: "run_ident_grant",
      phaseContext: { experience: { repo_memory: { focus_paths: [chrome] } } },
      manifest: { verb: "check" },
      phase: "discover",
    });
    const granted = await resolveContextRequest({
      workspaceRoot: root,
      runId: "run_ident_grant",
      manifest: { verb: "check", intent: "calendar", phase: "discover" },
      capsuleDir,
      need: "SurfaceMode type definition",
      retrieve: false,
    });
    expect(granted.ok).toBe(true);
    expect(granted.status).toBe("GRANTED");
    expect(granted.packet_delta.paths).toContain(types);
    const missPath = path.join(
      root,
      ".cursor/aaac/state/runs/run_ident_grant/artifacts/retrieval_misses.json",
    );
    const store = JSON.parse(fs.readFileSync(missPath, "utf8"));
    expect(store.misses[0].granted_paths).toContain(types);
  });

  it("returns IN_PACKET without a new miss when the file is already granted", async () => {
    const { root, types } = writeCalendarWorkspace();
    const { capsuleDir } = materializeWorkerCapsule({
      workspaceRoot: root,
      runId: "run_ident_packet",
      phaseContext: { experience: { repo_memory: { focus_paths: [types] } } },
      manifest: { verb: "check" },
      phase: "discover",
    });
    const before = readCapsuleGrants(capsuleDir);
    const result = await resolveContextRequest({
      workspaceRoot: root,
      runId: "run_ident_packet",
      manifest: { verb: "check", intent: "calendar", phase: "discover" },
      capsuleDir,
      need: "SurfaceMode type definition",
      retrieve: false,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("IN_PACKET");
    expect(result.taxonomy).toBe(CONTEXT_EVENTS.PACKET_CACHE_HIT);
    expect(result.packet_delta.paths).toContain(types);
    expect(readCapsuleGrants(capsuleDir).expansions).toBe(before.expansions);
    expect(
      fs.existsSync(
        path.join(
          root,
          ".cursor/aaac/state/runs/run_ident_packet/artifacts/retrieval_misses.json",
        ),
      ),
    ).toBe(false);
  });

  it("grants docs/*.md named in the graph", async () => {
    const { root, types, arch } = writeCalendarWorkspace();
    const { capsuleDir } = materializeWorkerCapsule({
      workspaceRoot: root,
      runId: "run_ident_docs",
      phaseContext: { experience: { repo_memory: { focus_paths: [types] } } },
      manifest: { verb: "check" },
      phase: "discover",
    });
    const granted = await resolveContextRequest({
      workspaceRoot: root,
      runId: "run_ident_docs",
      manifest: { verb: "check", intent: "calendar", phase: "discover" },
      capsuleDir,
      need: "docs/architecture.md",
      retrieve: false,
    });
    expect(granted.ok).toBe(true);
    expect(granted.status).toBe("GRANTED");
    expect(granted.packet_delta.paths).toContain(arch);
    expect(addGrantToCapsule({ workspaceRoot: root, capsuleDir, relPath: arch }).ok).toBe(
      true,
    );
  });
});

describe("learn identifier grants", () => {
  it("learns SurfaceMode → types.ts from api, not basename", () => {
    const types = "src/domain/celestial/types.ts";
    expect(
      nodeMatchesSought(types, "SurfaceMode type definition", "SurfaceMode, OverlayKind"),
    ).toBe(true);
    const out = confirmLearnCandidates({
      sought: "SurfaceMode type definition",
      grantedPaths: [types],
      apiByPath: { [types]: "SurfaceMode, OverlayKind" },
    });
    expect(out.confirmed).toContain(types);
    expect(out.skipReason).toBeNull();
  });

  it("keeps IPC → toast as weak_grant", () => {
    const toast = "src/hooks/useRepoMemoryToasts.ts";
    const out = confirmLearnCandidates({
      sought: "IPC/preload handlers for getRepoGraph, ensureRepoMemory, pollRepoMemoryEvents",
      grantedPaths: [toast],
      apiByPath: { [toast]: "useRepoMemoryToasts" },
    });
    expect(out.confirmed).toEqual([]);
    expect(out.skipReason).toBe("weak_grant");
  });

  it("writes a retrieval alias when the graph already has the api", () => {
    const artifacts = tmpDir("aaac-ident-learn-");
    const types = "src/domain/celestial/types.ts";
    fs.writeFileSync(
      path.join(artifacts, "retrieval_misses.json"),
      JSON.stringify({
        misses: [
          {
            sought: "SurfaceMode type definition",
            reason: "not_in_focus",
            taxonomy: CONTEXT_EVENTS.CONCEPTUAL_REQUEST,
            granted_paths: [types],
          },
        ],
      }),
    );
    const graph = emptyRepoGraph();
    upsertNode(graph, {
      id: nodeIdForPath(types),
      kind: "file",
      path: types,
      api: "SurfaceMode, OverlayKind",
    });
    const out = learnFromRetrievalMisses(graph, {
      trajectory: { quality: { ok: true }, paths_touched: [] },
      manifest: { object: "calendar", intent: "check architecture calendar" },
      artifactsDir: artifacts,
    });
    expect(out.learned).toHaveLength(1);
    expect(out.learned[0].paths).toContain(types);
  });
});
