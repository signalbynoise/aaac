import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { emptyRepoGraph } from "../src/run-engine/experience/repo-graph.mjs";
import { learnFromRetrievalMisses } from "../src/run-engine/experience/repo-learn.mjs";
import {
  parseGrantedNotes,
  grantedPathConfirmed,
  confirmLearnCandidates,
  grantedPathsFromMiss,
} from "../src/run-engine/experience/granted-paths.mjs";
import { normalizeRetrievalMiss } from "../src/run-engine/retrieval-miss.mjs";
import { CONTEXT_EVENTS } from "../src/run-engine/context-taxonomy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bd9d = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/granted-misses/bd9d-sample.json"),
    "utf8",
  ),
);

function writeMissArtifacts(misses, extra = {}) {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-granted-"));
  fs.writeFileSync(
    path.join(artifacts, "retrieval_misses.json"),
    JSON.stringify({ misses }),
  );
  if (extra.heal) {
    fs.writeFileSync(
      path.join(artifacts, "retrieval_heal.json"),
      JSON.stringify(extra.heal),
    );
  }
  if (extra.jsonl) {
    fs.writeFileSync(path.join(artifacts, "context_taxonomy.jsonl"), extra.jsonl);
  }
  return artifacts;
}

describe("granted-paths", () => {
  it("parses granted: notes", () => {
    expect(
      parseGrantedNotes(
        "granted:apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx,apps/agentic-os/src/main/repo-memory.ts",
      ),
    ).toEqual([
      "apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx",
      "apps/agentic-os/src/main/repo-memory.ts",
    ]);
  });

  it("confirms basename named in the ask and rejects toast-hook grants", () => {
    expect(
      grantedPathConfirmed(
        "apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx",
        "parent screen or rail that renders MemoryGraphPanel",
      ),
    ).toBe(true);
    expect(
      grantedPathConfirmed(
        "apps/agentic-os/src/renderer/hooks/useRepoMemoryToasts.ts",
        "IPC/preload handlers for getRepoGraph, ensureRepoMemory, pollRepoMemoryEvents",
      ),
    ).toBe(false);
  });

  it("joins context_taxonomy.jsonl need to paths", () => {
    const artifacts = writeMissArtifacts([]);
    fs.writeFileSync(
      path.join(artifacts, "context_taxonomy.jsonl"),
      `${JSON.stringify({
        tool: "request_context",
        need: "parent screen or rail that renders MemoryGraphPanel",
        paths: ["apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx"],
      })}\n`,
    );
    const paths = grantedPathsFromMiss(
      { sought: "parent screen or rail that renders MemoryGraphPanel" },
      artifacts,
    );
    expect(paths).toContain(
      "apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx",
    );
  });
});

describe("normalizeRetrievalMiss granted fields", () => {
  it("persists taxonomy and granted_paths", () => {
    const r = normalizeRetrievalMiss({
      sought: "parent screen or rail that renders MemoryGraphPanel",
      reason: "not_in_focus",
      taxonomy: CONTEXT_EVENTS.CONCEPTUAL_REQUEST,
      granted_paths: ["apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx"],
      notes: "granted:apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx",
    });
    expect(r.ok).toBe(true);
    expect(r.miss.taxonomy).toBe(CONTEXT_EVENTS.CONCEPTUAL_REQUEST);
    expect(r.miss.granted_paths).toContain(
      "apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx",
    );
  });

  it("fills granted_paths from notes when the field is missing", () => {
    const r = normalizeRetrievalMiss({
      sought: "MemoryGraphPanel mount",
      notes: "granted:apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx",
    });
    expect(r.miss.granted_paths).toEqual([
      "apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx",
    ]);
  });
});

describe("learnFromRetrievalMisses granted conceptual", () => {
  it("learns English conceptual miss when granted file is named in the ask", () => {
    const artifacts = writeMissArtifacts([bd9d.misses[0]]);
    const out = learnFromRetrievalMisses(emptyRepoGraph(), {
      trajectory: { quality: { ok: true }, paths_touched: [] },
      manifest: { object: "architecture" },
      artifactsDir: artifacts,
    });
    expect(out.learned).toHaveLength(1);
    expect(out.learned[0].paths).toContain(
      "apps/agentic-os/src/renderer/components/MemoryGraphPanel.tsx",
    );
  });

  it("skips conceptual miss with no grants", () => {
    const artifacts = writeMissArtifacts([bd9d.misses[2]]);
    const out = learnFromRetrievalMisses(emptyRepoGraph(), {
      trajectory: { quality: { ok: true }, paths_touched: [] },
      manifest: { object: "architecture" },
      artifactsDir: artifacts,
    });
    expect(out.learned).toEqual([]);
    expect(out.skipped.some((s) => s.reason === "conceptual")).toBe(true);
  });

  it("skips IPC-style grant of the toast hook as weak_grant", () => {
    const artifacts = writeMissArtifacts([bd9d.misses[1]]);
    const out = learnFromRetrievalMisses(emptyRepoGraph(), {
      trajectory: { quality: { ok: true }, paths_touched: [] },
      manifest: { object: "architecture" },
      artifactsDir: artifacts,
    });
    expect(out.learned).toEqual([]);
    expect(out.skipped.some((s) => s.reason === "weak_grant")).toBe(true);
  });

  it("does not learn from global resolved_paths", () => {
    const popular = "apps/agentic-os/src/main/repo-memory.ts";
    const artifacts = writeMissArtifacts(
      [{ sought: "PhaseTimeline.tsx graph coupling", reason: "not_in_focus" }],
      {
        heal: {
          sought_terms: ["PhaseTimeline.tsx graph coupling"],
          resolved_paths: [popular],
          by_sought: { "PhaseTimeline.tsx graph coupling": [] },
        },
      },
    );
    const out = learnFromRetrievalMisses(emptyRepoGraph(), {
      trajectory: { quality: { ok: true }, paths_touched: [popular] },
      manifest: { object: "component" },
      artifactsDir: artifacts,
    });
    expect(out.learned.length).toBe(0);
  });

  it("confirmLearnCandidates never returns global resolved_paths", () => {
    const out = confirmLearnCandidates({
      sought: "PhaseTimeline.tsx graph coupling",
      grantedPaths: [],
      bySoughtHits: [],
      harvested: ["apps/agentic-os/src/main/repo-memory.ts"],
    });
    expect(out.confirmed).toEqual([]);
  });
});
