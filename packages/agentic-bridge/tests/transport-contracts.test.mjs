import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  accumulateCursorUsage,
  createCursorUsageAccumulator,
  cursorUsageMetrics,
  parseCursorUsageEvent,
} from "../src/cursor-usage.mjs";
import { createCursorLocalAdapter } from "../src/cursor-adapter.mjs";
import {
  normalizePhaseEvent,
  phaseEventToStreamEntry,
} from "../src/phase-event-contract.mjs";
import {
  persistSwarmExpectedSpecs,
  recordAgentComplete,
  recordAgentLaunch,
} from "../src/run-manifest.mjs";
import { PhaseRunner } from "../src/phase-runner.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const RUNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/runs");
const createdPaths = [];

function createRunManifest(overrides = {}) {
  const runDir = fs.mkdtempSync(path.join(RUNS_ROOT, "bridge-contract-"));
  const runId = path.basename(runDir);
  const manifest = {
    run_id: runId,
    phase: "discover",
    phase_kind: "work",
    verb: "check",
    command: "check-app",
    swarm: { agents: [], task_launches_this_phase: 0 },
    log: [],
    ...overrides,
  };
  fs.writeFileSync(
    path.join(runDir, "run.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  createdPaths.push(runDir);
  return { runId, runDir, manifest };
}

function readRun(runDir) {
  return JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
}

function createFakeCursorCli(events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-cursor-cli-"));
  const file = path.join(dir, "cursor");
  const source = [
    "#!/usr/bin/env node",
    `const events = ${JSON.stringify(events)};`,
    "for (const event of events) process.stdout.write(`${JSON.stringify(event)}\\n`);",
  ].join("\n");
  fs.writeFileSync(file, source);
  fs.chmodSync(file, 0o755);
  createdPaths.push(dir);
  return file;
}

async function collectAdapterEvents(adapter, context) {
  const events = [];
  for await (const event of adapter.runPhase(context)) events.push(event);
  return events;
}

async function runOfflineAdapter(events, context) {
  const previousBin = process.env.CURSOR_AGENT_BIN;
  const previousKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_AGENT_BIN = createFakeCursorCli(events);
  process.env.CURSOR_API_KEY = "offline-test-key";
  try {
    return await collectAdapterEvents(createCursorLocalAdapter(), context);
  } finally {
    if (previousBin == null) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = previousBin;
    if (previousKey == null) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = previousKey;
  }
}

afterEach(() => {
  while (createdPaths.length > 0) {
    fs.rmSync(createdPaths.pop(), { recursive: true, force: true });
  }
});

describe("Cursor exact usage transport", () => {
  it("parses documented camelCase and snake_case usage components exactly", () => {
    expect(parseCursorUsageEvent({
      type: "token-usage",
      requestId: "req-camel",
      usage: {
        inputTokens: 101,
        outputTokens: 23,
        cacheReadTokens: 7,
        cacheWriteTokens: 5,
        reasoningTokens: 11,
        contextPercent: 12.5,
      },
    })).toEqual({
      kind: "usage",
      tokens: 136,
      context: 12.5,
      requestId: "req-camel",
    });

    expect(parseCursorUsageEvent({
      type: "token_usage",
      request_id: "req-snake",
      payload: {
        input_tokens: 200,
        output_tokens: 40,
        cache_read_tokens: 10,
        cache_write_tokens: 3,
        reasoning_tokens: 17,
        context_tokens: 32_000,
        context_window_size: 128_000,
      },
    })).toEqual({
      kind: "usage",
      tokens: 253,
      context: 25,
      requestId: "req-snake",
    });
  });

  it("prefers an exact total and deduplicates repeated request ids", () => {
    const first = parseCursorUsageEvent({
      type: "token-usage",
      request_id: "request-1",
      payload: { total_tokens: 900, input_tokens: 1, output_tokens: 2 },
    });
    const duplicate = parseCursorUsageEvent({
      type: "token-usage",
      requestId: "request-1",
      payload: { totalTokens: 900 },
    });
    const second = parseCursorUsageEvent({
      usage: { totalTokens: 100 },
      requestId: "request-2",
    });
    const state = createCursorUsageAccumulator();

    expect(accumulateCursorUsage(state, first)).toBe(true);
    expect(accumulateCursorUsage(state, duplicate)).toBe(false);
    expect(accumulateCursorUsage(state, second)).toBe(true);
    expect(cursorUsageMetrics(state)).toEqual({
      tokens: 1_000,
      context: null,
      tokenSource: "cursor_cli_usage",
      requestIds: ["request-1", "request-2"],
    });
  });

  it("rejects missing, unknown, textual, and invalid usage fields", () => {
    expect(parseCursorUsageEvent({ type: "token-usage", payload: {} })).toBeNull();
    expect(parseCursorUsageEvent({
      type: "token_usage",
      payload: { prompt_chars: 4_000, completion_chars: 2_000 },
    })).toBeNull();
    expect(parseCursorUsageEvent({
      usage: { inputTokens: "100", outputTokens: -1 },
    })).toBeNull();
    expect(parseCursorUsageEvent({
      type: "result",
      result: "A long response that must never become a token estimate.",
    })).toBeNull();
  });

  it("reports CLI-no-usage as unavailable without estimating characters", async () => {
    const events = await runOfflineAdapter([
      { type: "result", result: "x".repeat(8_000), session_id: "session-no-usage" },
    ], {
      workspaceRoot: REPO_ROOT,
      runId: "run-no-usage",
      phase: "discover",
      agentIndex: 0,
      initialSummary: "Inspecting usage transport",
      prompt: "offline fixture",
    });
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      metrics: {
        tokens: null,
        context: null,
        tokenSource: "unavailable",
      },
    });
  });

  it("accumulates per-turn usage and emits exact completed metrics", async () => {
    const events = await runOfflineAdapter([
      {
        type: "token-usage",
        requestId: "turn-1",
        usage: { inputTokens: 100, outputTokens: 20 },
      },
      {
        type: "token_usage",
        request_id: "turn-2",
        payload: {
          input_tokens: 200,
          output_tokens: 50,
          context_tokens: 64_000,
          context_window_size: 128_000,
        },
      },
      {
        type: "token_usage",
        request_id: "turn-2",
        payload: { total_tokens: 250 },
      },
      { type: "result", result: "done", session_id: "session-usage" },
    ], {
      workspaceRoot: REPO_ROOT,
      runId: "run-usage",
      phase: "discover",
      agentIndex: 0,
      initialSummary: "Inspecting usage transport",
      prompt: "offline fixture",
    });
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      cursorRunId: "session-usage",
      metrics: {
        tokens: 370,
        context: 50,
        tokenSource: "cursor_cli_usage",
        requestIds: ["turn-1", "turn-2"],
      },
    });
  });

  it("only derives exact context from an explicit percent or complete token pair", () => {
    const noContext = [
      { usage: { totalTokens: 10, contextTokens: 2_000 } },
      { usage: { totalTokens: 10, contextWindowSize: 8_000 } },
      { usage: { totalTokens: 10 }, contextWindowSize: 8_000 },
      { usage: { totalTokens: 10, contextPercent: 101 } },
    ];
    for (const event of noContext) {
      expect(parseCursorUsageEvent(event)?.context).toBeNull();
    }
    expect(parseCursorUsageEvent({
      usage: { totalTokens: 10 },
      context_percentage: 37.5,
    })?.context).toBe(37.5);
  });
});

describe("phase metrics transport and persistence", () => {
  it("preserves structured completion metrics without technical narrative leakage", () => {
    const normalized = normalizePhaseEvent({
      runId: "run-metrics",
      phase: "discover",
      type: "completed",
      agentIndex: 2,
      detail: "tokens=370 context=50 token_source=cursor_cli_usage /private/file.ts",
      metrics: {
        tokens: 370,
        context: 50,
        tokenSource: "cursor_cli_usage",
        requestIds: ["turn-1", "turn-2"],
      },
    });
    const streamEntry = phaseEventToStreamEntry(normalized, "2026-07-20T09:00:00.000Z");

    expect(normalized).toEqual({
      runId: "run-metrics",
      phase: "discover",
      type: "completed",
      agentIndex: 2,
      metrics: {
        tokens: 370,
        context: 50,
        tokenSource: "cursor_cli_usage",
        requestIds: ["turn-1", "turn-2"],
      },
    });
    expect(streamEntry).toEqual({
      at: "2026-07-20T09:00:00.000Z",
      phase: "discover",
      type: "completed",
      agentIndex: 2,
      metrics: normalized.metrics,
    });
  });

  it("writes tokens, context, and token source on completion", () => {
    const { runId, runDir } = createRunManifest();
    recordAgentLaunch(REPO_ROOT, runId, {
      agentIndex: 0,
      phase: "discover",
      description: "usage persistence fixture",
    });
    recordAgentComplete(REPO_ROOT, runId, {
      phase: "discover",
      agentIndex: 0,
      metrics: {
        tokens: 370,
        context: 50,
        tokenSource: "cursor_cli_usage",
      },
    });

    expect(readRun(runDir).swarm.agents[0]).toMatchObject({
      tokens: 370,
      context: 50,
      token_source: "cursor_cli_usage",
    });
  });
});

describe("swarm roster and wave contracts", () => {
  it("persists phase-scoped expected specs with history and initial summaries", () => {
    const { runId, runDir } = createRunManifest();
    persistSwarmExpectedSpecs(REPO_ROOT, runId, [{
      id: "discovery-inventory",
      cursorPath: ".cursor/agents/discovery-inventory.md",
      initial_summary: "Inventorying relevant modules",
    }]);

    const manifest = readRun(runDir);
    const expected = [{
      id: "discovery-inventory",
      path: ".cursor/agents/discovery-inventory.md",
      initial_summary: "Inventorying relevant modules",
    }];
    expect(manifest.swarm.expected_specs_phase).toBe("discover");
    expect(manifest.swarm.expected_agent_specs).toEqual(expected);
    expect(manifest.swarm_history.discover.expected_agent_specs).toEqual(expected);
  });

  it("clears a stale expected roster when the current roster is empty", () => {
    const { runId, runDir } = createRunManifest({
      swarm: {
        agents: [],
        task_launches_this_phase: 0,
        expected_specs_phase: "plan",
        expected_agent_specs: [{ id: "stale", path: ".cursor/agents/stale.md" }],
      },
      swarm_history: {
        discover: {
          expected_agent_specs: [{ id: "older", path: ".cursor/agents/older.md" }],
        },
      },
    });
    persistSwarmExpectedSpecs(REPO_ROOT, runId, []);

    const manifest = readRun(runDir);
    expect(manifest.swarm.expected_specs_phase).toBe("discover");
    expect(manifest.swarm.expected_agent_specs).toEqual([]);
    expect(manifest.swarm_history.discover.expected_agent_specs).toEqual([]);
  });

  it("rejects a required swarm phase with an empty graph roster", async () => {
    const { runId, manifest } = createRunManifest({
      phase: "unmapped_required_phase",
      swarm: {
        agents: [],
        task_launches_this_phase: 0,
        target_agents: { unmapped_required_phase: 2 },
      },
    });
    const runner = new PhaseRunner(REPO_ROOT, {
      adapter: { runPhase: async function* () {}, cancel: async () => {} },
    });

    await expect(
      runner.preparePhaseAgentPlan(runId, manifest, "unmapped_required_phase"),
    ).rejects.toThrow(
      "Swarm-required phase unmapped_required_phase has no graph agent roster",
    );
    runner.stopWatching();
  });

  it("preserves global agent slot indexing across sequential waves", async () => {
    const runner = new PhaseRunner(REPO_ROOT, {
      adapter: { runPhase: async function* () {}, cancel: async () => {} },
    });
    const calls = [];
    runner.runSingleAgent = async (
      runId,
      manifest,
      phase,
      agentIndex,
      count,
      prompt,
      agentSpec,
    ) => {
      calls.push({ runId, phase, agentIndex, count, prompt, agentSpec });
    };
    const specs = Array.from({ length: 5 }, (_, index) => ({
      id: `slot-${index}`,
      relPath: `agents/slot-${index}.md`,
      cursorPath: `.cursor/agents/slot-${index}.md`,
    }));
    const manifest = {
      run_id: "run-waves",
      command: "check-app",
      verb: "check",
      phase_kind: "work",
    };

    await runner.runAgentWave(
      "run-waves", manifest, "discover", 0, 5, 2, specs,
    );
    await runner.runAgentWave(
      "run-waves", manifest, "discover", 2, 5, 3, specs,
    );

    expect(calls.map(({ agentIndex }) => agentIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(calls.map(({ agentSpec }) => agentSpec.id)).toEqual([
      "slot-0",
      "slot-1",
      "slot-2",
      "slot-3",
      "slot-4",
    ]);
    runner.stopWatching();
  });
});
