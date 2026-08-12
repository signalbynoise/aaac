import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseStageSummariesYaml,
  writeStageSummary,
} from '../src/run-engine/write-stage-summary.mjs';
import {
  cleanupRun,
  nextRunId,
  runManifestPath,
  seedRun,
  writeArtifact,
} from "./fixtures/run-state.mjs";

const PHASE = "discover";
const ARTIFACT_REL = "artifacts/semantic.yaml";
const ENFORCEMENT = {
  phase_artifacts: { [PHASE]: [ARTIFACT_REL] },
};
const SEEDED_RUNS = [];

function createManifest(runId, agents, swarmHistory = null) {
  return {
    run_id: runId,
    command: "fix-architecture",
    verb: "fix",
    phase: PHASE,
    status: "running",
    swarm: {
      phase: PHASE,
      task_launches_this_phase: agents.length,
      agents,
    },
    ...(swarmHistory ? { swarm_history: swarmHistory } : {}),
  };
}

function seedSummaryRun({
  label,
  agents = [],
  artifact = "summary: Artifact evidence safely explains the completed work.",
  swarmHistory = null,
}) {
  const runId = nextRunId(label);
  SEEDED_RUNS.push(runId);
  seedRun(createManifest(runId, agents, swarmHistory));
  if (artifact != null) writeArtifact(runId, ARTIFACT_REL, artifact);
  return runId;
}

function writeSummary(runId) {
  return writeStageSummary(runId, PHASE, { enforcement: ENFORCEMENT });
}

function readPersistedSummary(runId) {
  return parseStageSummariesYaml(fs.readFileSync(summaryPath(runId), "utf8"))
    .phases[PHASE];
}

function summaryPath(runId) {
  return path.join(
    process.env.AAAC_WORKSPACE_ROOT,
    ".cursor/aaac/state/runs",
    runId,
    "artifacts/stage_summaries.yaml",
  );
}

function updateManifest(runId, update) {
  const manifestPath = runManifestPath(runId);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  update(manifest);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function readManifest(runId) {
  return JSON.parse(fs.readFileSync(runManifestPath(runId), "utf8"));
}

function multiAttemptAgents() {
  return [
    {
      index: 1,
      phase: PHASE,
      subagent_id: "prior-attempt",
      started_at: "2026-07-19T10:00:01.000Z",
      completed_at: "2026-07-19T10:03:00.000Z",
      summary: "Prior attempt found obsolete architecture behavior",
      tokens: 900,
      context: 90,
      files_source: "metered_hook",
      files_read: 8,
      files_written: 2,
      files_edited: 4,
    },
    {
      index: 1,
      phase: PHASE,
      subagent_id: "latest-attempt",
      started_at: "2026-07-19T12:00:01.000Z",
      last_progress: "Checking newest retry summary behavior across the architecture",
      tokens: 200,
      context: 20,
      files_source: "metered_hook",
      files_read: 2,
      files_written: 0,
      files_edited: 1,
    },
  ];
}

function installMultiAttemptLog(runId) {
  updateManifest(runId, (manifest) => {
    manifest.log = [
      { at: "2026-07-19T10:00:00.000Z", phase: PHASE, event: "phase_start" },
      { at: "2026-07-19T10:03:01.000Z", phase: PHASE, event: "failed" },
      { at: "2026-07-19T12:00:00.000Z", phase: PHASE, event: "phase_start" },
    ];
  });
}

afterEach(() => {
  for (const runId of SEEDED_RUNS.splice(0)) cleanupRun(runId);
});

describe("semantic stage-summary precedence", () => {
  it.each([
    {
      label: "final summary precedes progress and initial summary",
      agent: {
        completed_at: "2026-07-19T12:00:00.000Z",
        summary: "Final semantic outcome explains the completed architecture work",
        last_progress: "Reviewing semantic progress",
        initial_summary: "Inspect architecture boundaries",
      },
      expected:
        "Final semantic outcome explains the completed architecture work. Reviewing semantic progress. Inspect architecture boundaries",
    },
    {
      label: "last progress precedes initial summary",
      agent: {
        last_progress: "Reviewing the resolved architecture boundaries",
        initial_summary: "Inspect architecture boundaries",
      },
      expected:
        "Reviewing the resolved architecture boundaries. Inspect architecture boundaries",
    },
    {
      label: "initial summary is used when later semantics are absent",
      agent: {
        initial_summary: "Inspect architecture boundaries before implementation",
      },
      expected: "Inspect architecture boundaries before implementation",
    },
  ])("$label", ({ agent, expected }) => {
    const runId = seedSummaryRun({
      label: "semantic-precedence",
      agents: [{ phase: PHASE, ...agent }],
    });

    expect(writeSummary(runId)).toMatchObject({
      status: "validated",
      layman: expected,
    });
  });

  it("skips an unsafe peer candidate while preserving a safe peer summary", () => {
    const safeSummary =
      "Validated the architecture boundaries and preserved clear ownership across affected capabilities";
    const runId = seedSummaryRun({
      label: "unsafe-peer",
      agents: [
        {
          phase: PHASE,
          subagent_id: "unsafe-peer",
          completed_at: "2026-07-19T12:00:00.000Z",
          summary: "pnpm test exposes technical command output",
        },
        {
          phase: PHASE,
          subagent_id: "safe-peer",
          completed_at: "2026-07-19T12:01:00.000Z",
          summary: safeSummary,
        },
      ],
    });

    const result = writeSummary(runId);
    const persisted = readPersistedSummary(runId);

    expect(result).toMatchObject({
      status: "validated",
      layman: safeSummary,
    });
    expect(persisted.source_artifacts).toEqual(["agent:safe-peer:summary"]);
    expect(persisted.source_artifacts.every(Boolean)).toBe(true);
  });
});

describe("semantic stage-summary safety", () => {
  it("validates a semantic roster summary without artifact mapping", () => {
    const semanticSummary =
      "Validated the complete semantic roster while preserving clear ownership and predictable phase outcomes";
    const runId = seedSummaryRun({
      label: "semantic-no-artifact-map",
      agents: [{
        phase: PHASE,
        subagent_id: "semantic-agent",
        completed_at: "2026-07-19T12:00:00.000Z",
        summary: semanticSummary,
      }],
      artifact: null,
    });

    const result = writeStageSummary(runId, PHASE, {
      enforcement: { phase_artifacts: {} },
    });

    expect(result).toMatchObject({
      status: "validated",
      layman: semanticSummary,
    });
    expect(result.layman.length).toBeLessThanOrEqual(280);
    expect(readPersistedSummary(runId).source_artifacts).toEqual([
      "agent:semantic-agent:summary",
    ]);
  });

  it("deduplicates semantic sentences and enforces sentence and character bounds", () => {
    const first =
      "Validated the architecture boundaries and confirmed ownership remains clear for every affected capability";
    const second =
      "Confirmed dependency direction remains predictable across all affected modules and runtime handoffs";
    const third =
      "Verified the implementation preserves deterministic behavior while keeping responsibilities separated";
    const fourth =
      "Reviewed an additional outcome that must be excluded by the semantic sentence limit";
    const runId = seedSummaryRun({
      label: "semantic-bounds",
      agents: [
        { phase: PHASE, completed_at: "2026-07-19T12:00:00.000Z", summary: first },
        { phase: PHASE, completed_at: "2026-07-19T12:01:00.000Z", summary: `${first}.` },
        { phase: PHASE, completed_at: "2026-07-19T12:02:00.000Z", summary: second },
        { phase: PHASE, completed_at: "2026-07-19T12:03:00.000Z", summary: third },
        { phase: PHASE, completed_at: "2026-07-19T12:04:00.000Z", summary: fourth },
      ],
    });

    const result = writeSummary(runId);

    expect(result.status).toBe("validated");
    expect(result.layman.length).toBeLessThanOrEqual(280);
    expect(result.layman.endsWith("…")).toBe(true);
    expect(result.layman.toLowerCase().split(first.toLowerCase())).toHaveLength(2);
    expect(result.layman).not.toContain(fourth);
  });
});

describe("historical stage-summary graph fallback", () => {
  it("uses the same-phase roster when a historical agent ID belongs to another phase", () => {
    const runId = seedSummaryRun({
      label: "historical-role",
      swarmHistory: {
        [PHASE]: {
          agents: [{ phase: PHASE, agent_spec_id: "code-author" }],
        },
      },
    });

    expect(writeSummary(runId)).toMatchObject({
      status: "validated",
      layman:
        "Find all files, routes, tests, and migrations belonging to the target domain — using the repo vector graph packet (find via graph, read via filesystem)",
    });
    expect(readPersistedSummary(runId).source_artifacts).toEqual([
      "phase-roster:discover:agent-spec:.cursor/agents/discovery-inventory.md#Role",
    ]);
  });

  it("derives a historical phase with no agent IDs from its graph roster", () => {
    const runId = seedSummaryRun({
      label: "historical-roster",
      swarmHistory: {
        [PHASE]: {
          target_agents: 1,
          agents: [{ phase: PHASE }],
        },
      },
    });

    expect(writeSummary(runId)).toMatchObject({
      status: "validated",
      layman: "Find all files, routes, tests, and migrations belonging to the target domain — using the repo vector graph packet (find via graph, read via filesystem)",
    });
    expect(readPersistedSummary(runId).source_artifacts).toEqual([
      "phase-roster:discover:agent-spec:.cursor/agents/discovery-inventory.md#Role",
    ]);
  });
});

const firstAgent = {
  phase: PHASE,
  subagent_id: "first-agent",
  completed_at: "2026-07-19T12:00:00.000Z",
  summary: "Confirmed clear ownership across every affected architecture boundary",
  tokens: 100,
  context: 10,
  files_source: "metered_hook",
  files_read: 2,
  files_written: 0,
  files_edited: 0,
};

describe("stage-summary source fingerprints", () => {
  it("leaves validated output byte-identical when source input is unchanged", () => {
    const runId = seedSummaryRun({
      label: "fingerprint-idempotent",
      agents: [firstAgent],
    });

    expect(writeSummary(runId).status).toBe("validated");
    const before = fs.readFileSync(summaryPath(runId), "utf8");
    const firstFingerprint = readPersistedSummary(runId).source_fingerprint;

    expect(writeSummary(runId)).toMatchObject({
      status: "validated",
      skipped: true,
      reason: "unchanged semantic input",
    });
    expect(fs.readFileSync(summaryPath(runId), "utf8")).toBe(before);
    expect(readPersistedSummary(runId).source_fingerprint).toBe(firstFingerprint);
  });

  it("refreshes layman content and metrics when agent history grows", () => {
    const runId = seedSummaryRun({
      label: "fingerprint-history-growth",
      agents: [firstAgent],
    });
    expect(writeSummary(runId).status).toBe("validated");
    const prior = readPersistedSummary(runId);

    updateManifest(runId, (manifest) => {
      manifest.swarm_history = {
        [PHASE]: {
          agents: [{
            phase: PHASE,
            subagent_id: "second-agent",
            completed_at: "2026-07-19T12:01:00.000Z",
            summary:
              "Verified predictable dependency direction throughout the reviewed system",
            tokens: 300,
            context: 30,
            files_source: "metered_hook",
            files_read: 3,
            files_written: 0,
            files_edited: 1,
          }],
        },
      };
    });

    const result = writeSummary(runId);
    const refreshed = readPersistedSummary(runId);
    expect(result.status).toBe("validated");
    expect(result.skipped).not.toBe(true);
    expect(refreshed.source_fingerprint).not.toBe(prior.source_fingerprint);
    expect(refreshed.layman).toContain("Verified predictable dependency direction");
    expect(refreshed.metrics).toMatchObject({
      agent_count: 2,
      files_explored: 6,
      avg_context_percent: 20,
      avg_tokens: 200,
    });
  });
});

describe("stage-summary fingerprint stability", () => {
  it("produces a stable fingerprint for equivalent source inputs", () => {
    const firstRunId = seedSummaryRun({
      label: "fingerprint-stable-first",
      agents: [firstAgent],
    });
    const secondRunId = seedSummaryRun({
      label: "fingerprint-stable-second",
      agents: [{ ...firstAgent }],
    });

    expect(writeSummary(firstRunId).status).toBe("validated");
    expect(writeSummary(secondRunId).status).toBe("validated");
    expect(readPersistedSummary(firstRunId).source_fingerprint).toBe(
      readPersistedSummary(secondRunId).source_fingerprint,
    );
  });
});

function verifyLatestAttemptSummaryRefresh() {
  const runId = seedSummaryRun({
    label: "fingerprint-latest-attempt",
    agents: multiAttemptAgents(),
  });
  installMultiAttemptLog(runId);

  expect(writeSummary(runId).status).toBe("validated");
  const initial = readPersistedSummary(runId);
  const initialBytes = fs.readFileSync(summaryPath(runId), "utf8");
  expect(initial.layman).toContain("Checking newest retry summary behavior");
  expect(initial.layman).not.toContain("Prior attempt");
  expect(initial.source_artifacts).toEqual(["agent:latest-attempt:last_progress"]);
  expect(initial.metrics).toMatchObject({
    agent_count: 1,
    files_explored: 3,
    avg_context_percent: 20,
    avg_tokens: 200,
  });

  updateManifest(runId, (manifest) => {
    manifest.swarm.agents[0].summary = "Prior attempt changed but remains historical";
    manifest.swarm.agents[0].tokens = 9_999;
  });
  expect(writeSummary(runId)).toMatchObject({
    status: "validated",
    skipped: true,
    reason: "unchanged semantic input",
  });
  expect(fs.readFileSync(summaryPath(runId), "utf8")).toBe(initialBytes);

  updateManifest(runId, (manifest) => {
    Object.assign(manifest.swarm.agents[1], {
      completed_at: "2026-07-19T12:04:00.000Z",
      summary: "Confirmed retry summaries now reflect only the newest phase attempt",
      tokens: 500,
      context: 25,
      files_read: 4,
      files_written: 1,
      files_edited: 2,
    });
  });
  expect(writeSummary(runId).status).toBe("validated");
  const refreshed = readPersistedSummary(runId);
  expect(refreshed.source_fingerprint).not.toBe(initial.source_fingerprint);
  expect(refreshed.layman).toBe(
    "Confirmed retry summaries now reflect only the newest phase attempt. Checking newest retry summary behavior across the architecture",
  );
  expect(refreshed.metrics).toMatchObject({
    agent_count: 1,
    files_explored: 7,
    avg_context_percent: 25,
    avg_tokens: 500,
  });
  expect(readManifest(runId).swarm.agents).toHaveLength(2);

  const refreshedBytes = fs.readFileSync(summaryPath(runId), "utf8");
  expect(writeSummary(runId)).toMatchObject({
    status: "validated",
    skipped: true,
    reason: "unchanged semantic input",
  });
  expect(fs.readFileSync(summaryPath(runId), "utf8")).toBe(refreshedBytes);
}

it(
  "refreshes only for latest-attempt completion and remains idempotent",
  verifyLatestAttemptSummaryRefresh,
);

describe("artifact stage-summary fallback", () => {
  it("uses a validated artifact only when semantic candidates are unavailable", () => {
    const artifactSummary =
      "Artifact evidence safely explains the completed architecture work.";
    const runId = seedSummaryRun({
      label: "artifact-fallback",
      agents: [{
        phase: PHASE,
        completed_at: "2026-07-19T12:00:00.000Z",
        summary: "pnpm test exposes technical command output",
        last_progress: "packages/aaac/src/internal.mjs",
        initial_summary: "tokens=1200 context=40",
      }],
      artifact: `summary: ${artifactSummary}`,
    });

    expect(writeSummary(runId)).toMatchObject({
      status: "validated",
      layman: artifactSummary,
    });
    expect(readPersistedSummary(runId).source_artifacts).toEqual([ARTIFACT_REL]);
  });

  it("fails closed when neither semantics nor artifact produce safe layman content", () => {
    const runId = seedSummaryRun({
      label: "artifact-fail-closed",
      artifact: "summary: tokens=1200 context=40 duration_ms=900",
    });

    const result = writeSummary(runId);
    const persisted = readPersistedSummary(runId);

    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/^VALIDATE_FAIL:/);
    expect(persisted.status).toBe("failed");
    expect(persisted.layman).toBeNull();
    expect(persisted.source_artifacts).toEqual([ARTIFACT_REL]);
    expect(persisted.source_artifacts.some((source) =>
      source.startsWith("agent:")
    )).toBe(false);
  });
});
