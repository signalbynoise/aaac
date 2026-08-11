/**
 * Index-time relational answers: blast, clusters, entry flows.
 */
import { describe, expect, it } from "vitest";
import {
  computeRepoRelations,
  relationsForPacket,
  shortestEntryFlow,
  needsRelationsUpgrade,
} from "../src/run-engine/experience/repo-index/relations.mjs";

function makeGraph() {
  return {
    version: 1,
    nodes: {
      "file:src/core.ts": {
        id: "file:src/core.ts",
        kind: "file",
        path: "src/core.ts",
        summary: "core",
      },
      "file:src/mid.ts": {
        id: "file:src/mid.ts",
        kind: "file",
        path: "src/mid.ts",
        summary: "mid",
      },
      "file:src/index.ts": {
        id: "file:src/index.ts",
        kind: "file",
        path: "src/index.ts",
        summary: "entry",
      },
      "file:other/alone.ts": {
        id: "file:other/alone.ts",
        kind: "file",
        path: "other/alone.ts",
        summary: "alone",
      },
    },
    edges: [
      { from: "file:src/index.ts", to: "file:src/mid.ts", kind: "imports", weight: 1 },
      { from: "file:src/mid.ts", to: "file:src/index.ts", kind: "imported_by", weight: 1 },
      { from: "file:src/mid.ts", to: "file:src/core.ts", kind: "imports", weight: 1 },
      { from: "file:src/core.ts", to: "file:src/mid.ts", kind: "imported_by", weight: 1 },
    ],
  };
}

describe("repo-index relations", () => {
  it("computes blast, clusters, and entries", () => {
    const graph = makeGraph();
    const detail = computeRepoRelations(graph, {
      cfg: { blast_depth: 3, blast_cap: 40, flow_max_hops: 6 },
    });

    expect(detail.clusters).toBeGreaterThanOrEqual(2);
    expect(detail.entries).toBeGreaterThanOrEqual(1);
    expect(graph.nodes["file:src/index.ts"].is_entry).toBe(true);
    expect(graph.nodes["file:src/core.ts"].blast_score).toBeGreaterThanOrEqual(1);
    expect(graph.nodes["file:src/core.ts"].blast_dependents).toContain("src/mid.ts");
    expect(graph.nodes["file:src/core.ts"].cluster_id).toBeTruthy();
    expect(graph.nodes["file:other/alone.ts"].cluster_id).not.toBe(
      graph.nodes["file:src/core.ts"].cluster_id,
    );
    expect(graph.relations.entries).toContain("file:src/index.ts");
  });

  it("finds entry flow to focus", () => {
    const graph = makeGraph();
    computeRepoRelations(graph);
    const flow = shortestEntryFlow(
      graph,
      graph.relations.entries,
      "file:src/core.ts",
      6,
    );
    expect(flow).toBeTruthy();
    expect(flow.entry).toBe("src/index.ts");
    expect(flow.chain).toEqual(["src/index.ts", "src/mid.ts", "src/core.ts"]);
  });

  it("builds retrieve packet relational slices", () => {
    const graph = makeGraph();
    graph.edges.push(
      { from: "file:src/mid.ts", to: "file:src/core.ts", kind: "calls", weight: 1 },
      { from: "file:src/core.ts", to: "file:src/mid.ts", kind: "called_by", weight: 1 },
    );
    computeRepoRelations(graph);
    const packet = relationsForPacket(
      graph,
      [{ nodeId: "file:src/core.ts", node: graph.nodes["file:src/core.ts"] }],
      {},
    );
    expect(packet.impact[0].path).toBe("src/core.ts");
    expect(packet.impact[0].blast_score).toBeGreaterThan(0);
    expect(packet.entry_flows[0].chain.length).toBeGreaterThanOrEqual(2);
    expect(packet.clusters.length).toBe(1);
    expect(packet.call_neighbors[0]).toMatchObject({
      path: "src/core.ts",
      callers: ["src/mid.ts"],
    });
  });

  it("detects relations upgrade need", () => {
    const graph = makeGraph();
    expect(needsRelationsUpgrade(graph)).toBe(true);
    computeRepoRelations(graph);
    expect(needsRelationsUpgrade(graph)).toBe(false);
  });
});
