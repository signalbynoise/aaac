import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  readRunManifest,
  readRunManifestForExecution,
} from "../src/dispatch.mjs";
import { normalizeRunManifestReadModel } from "../src/run-manifest-read-model.mjs";
import { RunWatcher } from "../src/run-watcher.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const RUNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/runs");
const FITNESS_PHASE = "fitness_functions";
const FITNESS_SPECS = [
  {
    id: "boundary-review",
    path: ".cursor/agents/boundary-review.md",
    initial_summary:
      "Layer violations, fetch in UI, business logic in routes, cross-module coupling.",
  },
  {
    id: "doc-conformance",
    path: ".cursor/agents/doc-conformance.md",
    initial_summary:
      "Compare implementation diff against supporting docs and policies — not layer boundaries (see boundary-review).",
  },
  {
    id: "fallow-check-changed",
    path: ".cursor/agents/fallow-check-changed.md",
    initial_summary:
      "Check the changed work for new size or responsibility problems and explain anything that must be fixed.",
  },
];
const HISTORICAL_PHASE_SPECS = {
  impact_analysis: [
    {
      id: "impact-analysis",
      path: ".cursor/agents/impact-analysis.md",
      initial_summary:
        "Given an approved plan, list affected domains/systems and risk categories.",
    },
    {
      id: "dependency-analysis",
      path: ".cursor/agents/dependency-analysis.md",
      initial_summary:
        "Import direction, circular deps, god files, duplicate logic.",
    },
  ],
  dependency_graph: [
    {
      id: "dependency-analysis",
      path: ".cursor/agents/dependency-analysis.md",
      initial_summary:
        "Import direction, circular deps, god files, duplicate logic.",
    },
    {
      id: "boundary-review",
      path: ".cursor/agents/boundary-review.md",
      initial_summary:
        "Layer violations, fetch in UI, business logic in routes, cross-module coupling.",
    },
  ],
  fitness_functions: FITNESS_SPECS,
};
const HISTORICAL_ROSTERS = {
  ...Object.fromEntries(
    Object.entries(HISTORICAL_PHASE_SPECS).map(([phase, specs]) => [
      phase,
      specs.map((spec) => spec.id),
    ]),
  ),
};
const createdRunDirectories = [];

function genericFitnessAgent(index, overrides = {}) {
  return {
    index,
    phase: FITNESS_PHASE,
    agent_spec_id: `agent-${index}`,
    agent_spec_path: ".cursor/agents/dependency-analysis.md",
    started_at: `2026-07-20T10:0${index}:00.000Z`,
    completed_at: `2026-07-20T10:1${index}:00.000Z`,
    summary: `tokens=${index * 100}`,
    tokens: index * 100,
    context: index * 10,
    duration_ms: index * 1_000,
    ...overrides,
  };
}

function staleExpectedRoster() {
  return [
    {
      id: "dependency-analysis",
      path: ".cursor/agents/dependency-analysis.md",
    },
    {
      id: "impact-analysis",
      path: ".cursor/agents/impact-analysis.md",
    },
    {
      id: "system-decomposition",
      path: ".cursor/agents/system-decomposition.md",
    },
  ];
}

function historicalAgent(phase, index, overrides = {}) {
  return {
    index,
    phase,
    subagent_id: `${phase}-slot-${index}`,
    started_at: `2026-07-20T10:0${index}:00.000Z`,
    completed_at: `2026-07-20T10:1${index}:00.000Z`,
    duration_ms: index * 1_000,
    tokens: index * 100,
    context: index * 10,
    token_source: "cursor_cli_usage",
    files_read: index,
    files_written: index + 1,
    files_edited: index + 2,
    ...overrides,
  };
}

function screenshotShape() {
  const currentAgents = [
    genericFitnessAgent(3),
    genericFitnessAgent(1),
    genericFitnessAgent(2),
  ];
  const historyAgents = [
    genericFitnessAgent(2, { subagent_id: "history-slot-2" }),
    genericFitnessAgent(3, { subagent_id: "history-slot-3" }),
    genericFitnessAgent(1, { subagent_id: "history-slot-1" }),
  ];
  return {
    run_id: `fixture-${path.basename(REPO_ROOT)}`,
    phase: FITNESS_PHASE,
    verb: "check",
    command: "check-architecture",
    log: [
      {
        phase: FITNESS_PHASE,
        event: "phase_start",
        at: "2026-07-20T10:00:00.000Z",
      },
    ],
    swarm: {
      phase: FITNESS_PHASE,
      expected_specs_phase: "dependency_graph",
      expected_agent_specs: staleExpectedRoster(),
      target_agents: { [FITNESS_PHASE]: 3 },
      agents: [
        genericFitnessAgent(1, {
          agent_spec_id: "dependency-analysis",
          started_at: "2026-07-20T09:01:00.000Z",
          completed_at: "2026-07-20T09:02:00.000Z",
        }),
        ...currentAgents,
      ],
    },
    swarm_history: {
      [FITNESS_PHASE]: {
        target_agents: 3,
        expected_agent_specs: staleExpectedRoster(),
        agents: historyAgents,
      },
    },
  };
}

function expectFitnessSlots(agents) {
  const latest = agents
    .filter(
      (agent) =>
        agent.index <= FITNESS_SPECS.length &&
        agent.started_at >= "2026-07-20T10:00:00.000Z",
    )
    .sort((left, right) => left.index - right.index);
  expect(latest).toHaveLength(3);
  expect(
    latest.map(({ agent_spec_id, agent_spec_path, initial_summary, summary }) => ({
      agent_spec_id,
      agent_spec_path,
      initial_summary,
      summary,
    })),
  ).toEqual(
    FITNESS_SPECS.map((spec) => ({
      agent_spec_id: spec.id,
      agent_spec_path: spec.path,
      initial_summary: spec.initial_summary,
      summary: spec.initial_summary,
    })),
  );
}

function writePersistedFixture(manifest) {
  const runDirectory = fs.mkdtempSync(
    path.join(RUNS_ROOT, "bridge-read-model-"),
  );
  const runId = path.basename(runDirectory);
  const persisted = { ...manifest, run_id: runId };
  const bytes = `${JSON.stringify(persisted, null, 2)}\n`;
  const manifestPath = path.join(runDirectory, "run.json");
  fs.writeFileSync(manifestPath, bytes);
  createdRunDirectories.push(runDirectory);
  return { runId, manifestPath, bytes };
}

afterEach(() => {
  while (createdRunDirectories.length > 0) {
    fs.rmSync(createdRunDirectories.pop(), { recursive: true, force: true });
  }
});

describe("normalizeRunManifestReadModel", () => {
  it("replaces stale fitness rosters and normalizes current and historical generic slots", () => {
    const raw = screenshotShape();
    const rawBefore = JSON.stringify(raw);

    const normalized = normalizeRunManifestReadModel(REPO_ROOT, raw);

    expect(normalized.swarm.expected_specs_phase).toBe(FITNESS_PHASE);
    expect(normalized.swarm.expected_agent_specs).toEqual(FITNESS_SPECS);
    expect(normalized.swarm_history[FITNESS_PHASE].expected_agent_specs).toEqual(
      FITNESS_SPECS,
    );
    expectFitnessSlots(normalized.swarm.agents);
    expectFitnessSlots(normalized.swarm_history[FITNESS_PHASE].agents);
    expect(normalized.swarm.agents[0]).toMatchObject({
      agent_spec_id: "dependency-analysis",
      started_at: "2026-07-20T09:01:00.000Z",
    });
    expect(JSON.stringify(raw)).toBe(rawBefore);
  });

  it("preserves explicit identities, metrics, timestamps, and deterministic wave slots", () => {
    const explicit = {
      ...genericFitnessAgent(4),
      agent_spec_id: "boundary-review-wave-3",
      agent_spec_path: ".cursor/agents/custom-boundary-review.md",
      initial_summary: "Reviewing intentional fourth-wave boundaries for this run.",
      summary: "Confirmed fourth-wave boundaries and recorded actionable findings.",
      subagent_id: "explicit-fourth-wave",
      cursor_run_id: "cursor-run-fixture",
      token_source: "cursor_cli_usage",
    };
    const raw = {
      ...screenshotShape(),
      log: [],
      swarm: {
        phase: FITNESS_PHASE,
        expected_specs_phase: FITNESS_PHASE,
        expected_agent_specs: staleExpectedRoster(),
        target_agents: { [FITNESS_PHASE]: 4 },
        agents: [
          explicit,
          genericFitnessAgent(2),
          genericFitnessAgent(1),
          genericFitnessAgent(3),
        ],
      },
      swarm_history: {},
    };

    const first = normalizeRunManifestReadModel(REPO_ROOT, raw);
    const second = normalizeRunManifestReadModel(REPO_ROOT, raw);

    expect(first).toEqual(second);
    expect(first.swarm.expected_agent_specs.map((spec) => spec.id)).toEqual([
      "boundary-review",
      "doc-conformance",
      "fallow-check-changed",
      "boundary-review-wave-3",
    ]);
    expect(first.swarm.agents.find((agent) => agent.index === 4)).toEqual(explicit);
    expectFitnessSlots(first.swarm.agents);
  });

  it.each(Object.entries(HISTORICAL_ROSTERS))(
    "normalizes historical %s agents with wrong explicit ids by canonical slot",
    (phase, expectedIds) => {
      const raw = {
        run_id: "fixture-historical-roster-normalization",
        phase: "report",
        verb: "check",
        command: "check-architecture",
        log: [
          { phase, event: "phase_start", at: "2026-07-20T10:00:00.000Z" },
        ],
        swarm: { phase: "report", agents: [] },
        swarm_history: {
          [phase]: {
            target_agents: expectedIds.length,
            expected_agent_specs: staleExpectedRoster().slice(0, expectedIds.length),
            agents: expectedIds.map((_, index) => ({
              index: index + 1,
              phase,
              agent_spec_id: "system-decomposition",
              agent_spec_path: ".cursor/agents/system-decomposition.md",
              started_at: `2026-07-20T10:0${index + 1}:00.000Z`,
              completed_at: `2026-07-20T10:1${index + 1}:00.000Z`,
            })),
          },
        },
      };

      const normalized = normalizeRunManifestReadModel(REPO_ROOT, raw);
      const snapshot = normalized.swarm_history[phase];

      expect(snapshot.expected_agent_specs.map((spec) => spec.id)).toEqual(expectedIds);
      expect(snapshot.agents.map((agent) => agent.agent_spec_id)).toEqual(expectedIds);
      expect(snapshot.agents.map((agent) => agent.agent_spec_path)).toEqual(
        expectedIds.map((id) => `.cursor/agents/${id}.md`),
      );
    },
  );

  it("atomically remaps stale historical identities and Roles without changing valid outcomes or telemetry", () => {
    const staleRole =
      "Review stale historical ownership evidence and report the original role.";
    const preservedFinal =
      "Confirmed the dependency evidence is valid and recorded the final findings.";
    const canonicalImpactAgent = historicalAgent("impact_analysis", 2, {
      agent_spec_id: "dependency-analysis",
      agent_spec_path: ".cursor/agents/dependency-analysis.md",
      initial_summary: HISTORICAL_PHASE_SPECS.impact_analysis[1].initial_summary,
      summary:
        "Confirmed import direction remains valid and documented the final dependency findings.",
    });
    const raw = {
      run_id: "fixture-atomic-historical-remapping",
      phase: "report",
      verb: "check",
      command: "check-architecture",
      log: Object.keys(HISTORICAL_PHASE_SPECS).map((phase) => ({
        phase,
        event: "phase_start",
        at: "2026-07-20T10:00:00.000Z",
      })),
      swarm: { phase: "report", agents: [] },
      swarm_history: {
        impact_analysis: {
          expected_agent_specs: staleExpectedRoster().slice(0, 2),
          agents: [
            historicalAgent("impact_analysis", 1, {
              agent_spec_id: "system-decomposition",
              agent_spec_path: ".cursor/agents/system-decomposition.md",
              initial_summary: staleRole,
              summary: staleRole,
            }),
            canonicalImpactAgent,
          ],
        },
        dependency_graph: {
          expected_agent_specs: staleExpectedRoster().slice(0, 2),
          agents: [
            historicalAgent("dependency_graph", 1, {
              initial_summary: staleRole,
              summary: preservedFinal,
            }),
            historicalAgent("dependency_graph", 2, {
              agent_spec_id: "agent-2",
              agent_spec_path: ".cursor/agents/system-decomposition.md",
              initial_summary: staleRole,
              summary: staleRole,
            }),
          ],
        },
        fitness_functions: {
          expected_agent_specs: staleExpectedRoster(),
          agents: [
            historicalAgent("fitness_functions", 1, {
              agent_spec_id: "system-decomposition",
              agent_spec_path: ".cursor/agents/system-decomposition.md",
              initial_summary: staleRole,
              summary: staleRole,
            }),
            historicalAgent("fitness_functions", 2, {
              initial_summary: staleRole,
              summary: preservedFinal,
            }),
            historicalAgent("fitness_functions", 3, {
              agent_spec_id: "generic-agent-3",
              agent_spec_path: ".cursor/agents/system-decomposition.md",
              initial_summary: staleRole,
              summary: staleRole,
            }),
          ],
        },
      },
    };
    const rawBefore = structuredClone(raw);

    const normalized = normalizeRunManifestReadModel(REPO_ROOT, raw);

    for (const [phase, specs] of Object.entries(HISTORICAL_PHASE_SPECS)) {
      const beforeAgents = rawBefore.swarm_history[phase].agents;
      const snapshot = normalized.swarm_history[phase];
      expect(snapshot.expected_agent_specs).toEqual(specs);
      expect(snapshot.agents.map((agent) => agent.agent_spec_id)).toEqual(
        specs.map((spec) => spec.id),
      );
      expect(snapshot.agents.map((agent) => agent.agent_spec_path)).toEqual(
        specs.map((spec) => spec.path),
      );
      expect(snapshot.agents.map((agent) => agent.initial_summary)).toEqual(
        specs.map((spec) => spec.initial_summary),
      );
      snapshot.agents.forEach((agent, index) => {
        expect(agent).toMatchObject({
          started_at: beforeAgents[index].started_at,
          completed_at: beforeAgents[index].completed_at,
          duration_ms: beforeAgents[index].duration_ms,
          tokens: beforeAgents[index].tokens,
          context: beforeAgents[index].context,
          token_source: beforeAgents[index].token_source,
          files_read: beforeAgents[index].files_read,
          files_written: beforeAgents[index].files_written,
          files_edited: beforeAgents[index].files_edited,
        });
      });
    }

    expect(normalized.swarm_history.impact_analysis.agents[0].summary).toBe(
      HISTORICAL_PHASE_SPECS.impact_analysis[0].initial_summary,
    );
    expect(normalized.swarm_history.impact_analysis.agents[1]).toEqual(
      canonicalImpactAgent,
    );
    expect(normalized.swarm_history.dependency_graph.agents[0].summary).toBe(
      preservedFinal,
    );
    expect(normalized.swarm_history.dependency_graph.agents[1].summary).toBe(
      HISTORICAL_PHASE_SPECS.dependency_graph[1].initial_summary,
    );
    expect(normalized.swarm_history.fitness_functions.agents[1].summary).toBe(
      preservedFinal,
    );
    expect(normalized.swarm_history.fitness_functions.agents[2].summary).toBe(
      FITNESS_SPECS[2].initial_summary,
    );
    expect(raw).toEqual(rawBefore);
  });

  it("sanitizes canonical-id historical agents while preserving semantic text and legacy metrics", () => {
    const phase = "dependency_graph";
    const canonicalRole = HISTORICAL_PHASE_SPECS[phase][0].initial_summary;
    const validInitial =
      "Review dependency ownership boundaries and report concrete findings.";
    const validCurrent =
      "Comparing dependency ownership across the latest architecture evidence.";
    const validFinal =
      "Confirmed dependency ownership remains explicit across reviewed boundaries.";
    const raw = {
      run_id: "fixture-canonical-id-adversarial-history",
      phase: "report",
      verb: "check",
      command: "check-architecture",
      log: [
        { phase, event: "phase_start", at: "2026-07-20T09:00:00.000Z" },
        { phase, event: "phase_start", at: "2026-07-20T10:00:00.000Z" },
      ],
      swarm: { phase: "report", agents: [] },
      swarm_history: {
        [phase]: {
          expected_agent_specs: HISTORICAL_PHASE_SPECS[phase],
          agents: [
            historicalAgent(phase, 1, {
              agent_spec_id: "dependency-analysis",
              agent_spec_path: ".cursor/agents/dependency-analysis.md",
              started_at: "2026-07-20T09:01:00.000Z",
              completed_at: "2026-07-20T09:02:00.000Z",
              initial_summary: "Reading packages/private/legacy.ts",
              last_progress: "Working on the task",
              summary: "tokens=999 context=88",
              tokens: 999,
              context: 88,
              token_source: null,
            }),
            historicalAgent(phase, 1, {
              agent_spec_id: "dependency-analysis",
              agent_spec_path: ".cursor/agents/dependency-analysis.md",
              initial_summary: "Reading packages/private/current.ts",
              last_progress: "Working on the task",
              summary: "tokens=420 context=24",
              tokens: 420,
              context: 24,
              token_source: null,
            }),
            historicalAgent(phase, 2, {
              agent_spec_id: "boundary-review",
              agent_spec_path: ".cursor/agents/boundary-review.md",
              initial_summary: validInitial,
              last_progress: validCurrent,
              summary: validFinal,
              tokens: 640,
              context: 32,
              token_source: null,
            }),
          ],
        },
      },
    };

    const normalized = normalizeRunManifestReadModel(REPO_ROOT, raw);
    const [, fallbackAgent, semanticAgent] =
      normalized.swarm_history[phase].agents;

    expect(fallbackAgent).not.toHaveProperty("initial_summary");
    expect(fallbackAgent).not.toHaveProperty("last_progress");
    expect(fallbackAgent.summary).toBe(canonicalRole);
    expect(fallbackAgent).toMatchObject({
      tokens: 420,
      context: 24,
      token_source: "legacy_meter",
    });
    expect(semanticAgent).toMatchObject({
      initial_summary: validInitial,
      last_progress: validCurrent,
      summary: validFinal,
      tokens: 640,
      context: 32,
      token_source: "legacy_meter",
    });
  });

  it("adds legacy_meter only when a legacy agent has numeric usage metrics", () => {
    const raw = {
      run_id: "fixture-legacy-meter-display",
      phase: FITNESS_PHASE,
      verb: "check",
      command: "check-architecture",
      log: [
        { phase: FITNESS_PHASE, event: "phase_start", at: "2026-07-20T10:00:00.000Z" },
      ],
      swarm: {
        phase: FITNESS_PHASE,
        target_agents: { [FITNESS_PHASE]: 3 },
        agents: [
          genericFitnessAgent(1, { token_source: null, tokens: 420, context: null }),
          genericFitnessAgent(2, {
            token_source: null,
            tokens: null,
            context: 24,
          }),
          genericFitnessAgent(3, {
            token_source: null,
            tokens: null,
            context: null,
          }),
        ],
      },
    };

    const normalized = normalizeRunManifestReadModel(REPO_ROOT, raw);

    expect(normalized.swarm.agents.map((agent) => agent.token_source)).toEqual([
      "legacy_meter",
      "legacy_meter",
      null,
    ]);
    expect(normalized.swarm.agents[0].tokens).toBe(420);
  });

  it("keeps persisted bytes raw while display readers and watchers normalize", () => {
    const { runId, manifestPath, bytes } = writePersistedFixture(screenshotShape());

    const execution = readRunManifestForExecution(REPO_ROOT, runId);
    const display = readRunManifest(REPO_ROOT, runId);
    const watcher = new RunWatcher(REPO_ROOT);
    const watched = watcher._readManifest(runId);
    watcher.close();

    expect(execution.swarm.expected_agent_specs).toEqual(staleExpectedRoster());
    expect(display.swarm.expected_agent_specs).toEqual(FITNESS_SPECS);
    expect(watched.swarm.expected_agent_specs).toEqual(FITNESS_SPECS);
    expectFitnessSlots(display.swarm.agents);
    expectFitnessSlots(watched.swarm.agents);
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(bytes);
  });

  it("keeps PhaseRunner on raw execution reads", () => {
    const source = fs.readFileSync(
      new URL("../src/phase-runner.mjs", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /readRunManifestForExecution\s+as\s+readRunManifest/,
    );
    expect(source).not.toMatch(/normalizeRunManifestReadModel/);
  });
});
