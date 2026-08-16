import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { diffLogPhaseEvents, logEntryToPhaseEvent } from "../src/phase-log-stream.mjs";
import {
  formatAdapterStartedDetail,
} from "../src/cursor-adapter.mjs";
import {
  formatAgentMetricsDetail as formatAaacAgentMetricsDetail,
} from "../../aaac/src/run-engine/swarm-telemetry.mjs";
import {
  estimateUsageMetrics,
  formatAgentMetricsDetail,
} from "../src/phase-log-stream.mjs";
import { getCursorAuthStatus, isCursorAuthenticated } from "../src/cursor-auth.mjs";
import { dispatchRun, listRuns, readRunManifest } from "../src/dispatch.mjs";
import { runEngineScript } from "../src/paths.mjs";
import { RunWatcher } from "../src/run-watcher.mjs";
import { composePhasePrompt, composeSwarmCheckpointPrompt, composeSwarmAgentPrompt, getSwarmAgentSpecs } from "../src/prompt-compose.mjs";
import {
  recordAgentLaunch,
  recordAgentToolProgress,
  recordAgentComplete,
  persistSwarmExpectedSpecs,
} from "../src/run-manifest.mjs";
import { parseStreamJsonLine } from "../src/stream-json-tools.mjs";
import { extractSealedStageMetrics } from "../../aaac/src/run-engine/write-stage-summary.mjs";
import {
  logEntryToPhaseEvent as canonicalLogEntryToPhaseEvent,
  normalizePhaseEvent,
  phaseEventToStreamEntry,
} from "../src/phase-event-contract.mjs";
import { mutateAgentManifest } from "../../aaac/src/run-engine/swarm-telemetry.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function readBridgeSource(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function expectSourceContract(source, { required = [], forbidden = [] }) {
  for (const pattern of required) {
    expect(source).toMatch(pattern);
  }
  for (const pattern of forbidden) {
    expect(source).not.toMatch(pattern);
  }
}

function phaseBMeteringEvents() {
  return [
    {
      type: "tool_call",
      subtype: "started",
      call_id: "t1",
      tool_call: { readToolCall: { args: { path: "docs/architecture.md" } } },
    },
    {
      type: "tool_call",
      subtype: "completed",
      call_id: "t1",
      tool_call: {
        readToolCall: {
          args: { path: "docs/architecture.md" },
          result: { success: { totalLines: 40 } },
        },
      },
    },
    {
      type: "tool_call",
      subtype: "started",
      call_id: "t2",
      tool_call: { grepToolCall: { args: { pattern: "SITE_CONFIG" } } },
    },
    {
      type: "tool_call",
      subtype: "started",
      call_id: "t3",
      tool_call: { shellToolCall: { args: { command: "ls" } } },
    },
    {
      type: "tool_call",
      subtype: "started",
      call_id: "t4",
      tool_call: {
        writeToolCall: { args: { path: "artifacts/note.md", fileText: "x" } },
      },
    },
  ];
}

function spawnManifestWriter(modulePath, manifestPath, marker) {
  const source = [
    `import { mutateAgentManifest } from ${JSON.stringify(new URL(`file://${modulePath}`).href)};`,
    `mutateAgentManifest(${JSON.stringify(manifestPath)}, (manifest) => {`,
    `  manifest.records = manifest.records ?? [];`,
    `  manifest.records.push(${JSON.stringify(marker)});`,
    `});`,
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`manifest writer exited ${code}`));
    });
  });
}

async function verifyConcurrentManifestWritersAndStaleLockRecovery() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-progress-lock-"));
  const manifestPath = path.join(tempDir, "run.json");
  const packageTelemetry = path.join(
    REPO_ROOT,
    "packages/aaac/src/run-engine/swarm-telemetry.mjs",
  );
  const nativeTelemetry = path.join(
    REPO_ROOT,
    ".cursor/aaac/scripts/run-engine/swarm-telemetry.mjs",
  );
  fs.writeFileSync(manifestPath, JSON.stringify({ run_id: "run_lock", records: [] }));

  try {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        spawnManifestWriter(
          index % 2 === 0 ? packageTelemetry : nativeTelemetry,
          manifestPath,
          `record-${index}`,
        ),
      ),
    );
    const concurrent = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(new Set(concurrent.records)).toEqual(
      new Set(Array.from({ length: 12 }, (_, index) => `record-${index}`)),
    );

    const lockPath = `${manifestPath}.agent-progress.lock`;
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 0 }));
    const stale = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, stale, stale);
    mutateAgentManifest(
      manifestPath,
      (manifest) => {
        manifest.records.push("after-stale-lock");
      },
      { staleMs: 1_000, retries: 2, waitMs: 1 },
    );
    expect(JSON.parse(fs.readFileSync(manifestPath, "utf8")).records).toContain(
      "after-stale-lock",
    );
    expect(fs.existsSync(lockPath)).toBe(false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function verifyPhaseBStreamJsonFileMetering() {
  const result = await dispatchRun(
    REPO_ROOT,
    '/review-module cms "Phase B metering simulation"',
  );
  const runId = result.run_id;

  recordAgentLaunch(REPO_ROOT, runId, {
    agentIndex: 0,
    phase: "discover",
    subagentType: "explore",
    description: "discovery-inventory",
    agentSpecId: "discovery-inventory",
    agentSpecPath: ".cursor/agents/discovery-inventory.md",
  });

  const ndjson = phaseBMeteringEvents();

  const seen = new Set();
  for (const event of ndjson) {
    const parsed = parseStreamJsonLine(JSON.stringify(event));
    if (!parsed || parsed.kind !== "tool") continue;
    const callId = parsed.callId ?? `${parsed.toolName}`;
    if (seen.has(callId)) continue;
    seen.add(callId);
    recordAgentToolProgress(REPO_ROOT, runId, {
      phase: "discover",
      agentIndex: 0,
      toolName: parsed.toolName,
      path: parsed.path,
      detail: `Using ${parsed.toolName}`,
    });
  }

  recordAgentComplete(REPO_ROOT, runId, {
    phase: "discover",
    agentIndex: 0,
    detail: "Inventory complete",
  });

  const manifest = readRunManifest(REPO_ROOT, runId);
  const agent = manifest.swarm.agents.find((a) => a.phase === "discover");
  expect(agent.files_source).toBe("metered_bridge");
  expect(agent.files_read).toBe(2); // Read + Grep
  expect(agent.files_written).toBe(1);
  expect(agent.files_edited).toBe(0);
  expect(agent.initial_summary).toBeTruthy();
  expect(agent).not.toHaveProperty("last_progress");
  expect(agent.summary).toBe(agent.initial_summary);
  expect(agent.summary).not.toMatch(/Using |docs\/|artifacts\/|tokens=/);

  const stage = extractSealedStageMetrics(manifest, "discover");
  expect(stage.files_explored).toBe(3); // 2 read + 1 write

  fs.rmSync(path.join(REPO_ROOT, ".cursor/aaac/state/runs", runId), {
    recursive: true,
    force: true,
  });
}

describe("phase-log-stream", () => {
  it("logEntryToPhaseEvent maps agent_progress with agent_index", () => {
    const event = logEntryToPhaseEvent("run_a", {
      phase: "discover",
      event: "agent_progress",
      detail: "tokens=100 context=1.0 agent_index=2",
    });
    expect(event).toMatchObject({
      runId: "run_a",
      type: "progress",
      agentIndex: 1,
    });
  });

  it("diffLogPhaseEvents returns only new log entries", () => {
    const prev = [
      { phase: "discover", event: "agent_spawned", detail: '{"index":1}' },
    ];
    const next = [
      ...prev,
      {
        phase: "discover",
        event: "agent_progress",
        detail: "tokens=200 context=2.0 agent_index=1",
      },
    ];
    const events = diffLogPhaseEvents("run_a", prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("progress");
  });

  it("live IPC and replay normalize semantic fields identically", () => {
    const replay = canonicalLogEntryToPhaseEvent("run_a", {
      phase: "discover",
      event: "agent_progress",
      detail: JSON.stringify({
        agent_index: 2,
        semantic_summary: "Reviewing dependency boundaries",
      }),
    });
    const live = normalizePhaseEvent({
      runId: "run_a",
      phase: "discover",
      type: "progress",
      agentIndex: 1,
      semanticSummary: "Reviewing dependency boundaries",
    });

    expect(replay).toEqual(live);
    expect(phaseEventToStreamEntry(replay, "t1")).toEqual(
      phaseEventToStreamEntry(live, "t1"),
    );
  });

  it("metrics and artifacts remain technical-only during normalization", () => {
    const progress = normalizePhaseEvent({
      runId: "run_a",
      phase: "discover",
      type: "progress",
      agentIndex: 0,
      detail: "Reading /Users/example/private.ts tokens=400",
    });
    const completed = normalizePhaseEvent({
      runId: "run_a",
      phase: "discover",
      type: "completed",
      agentIndex: 0,
      detail: "tokens=400 context=2 artifact=report.md",
      metrics: { tokens: 400, context: 2 },
    });

    expect(progress).not.toHaveProperty("detail");
    expect(progress).not.toHaveProperty("semanticSummary");
    expect(completed).not.toHaveProperty("detail");
    expect(completed.metrics).toMatchObject({ tokens: 400, context: 2 });
    expect(completed.metrics).not.toHaveProperty("detail");
    expect(completed.metrics).not.toHaveProperty("semanticSummary");
  });
});

describe("cursor-adapter activity formatting", () => {
  it("formatAdapterStartedDetail records spawn metadata without prompt", () => {
    const detail = formatAdapterStartedDetail({
      phase: "discover",
      prompt: "/fix-app agentic-os \"Remove placeholders from phase timeline UI\"",
    });
    const parsed = JSON.parse(detail);

    expect(parsed).toEqual({
      phase: "discover",
      adapter: "cursor-local",
      origin: "agentic-os",
      started_at: parsed.started_at,
    });
    expect(parsed.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed).not.toHaveProperty("prompt");
    expect(detail).not.toContain("/fix-app agentic-os");
  });

  it("CLI stream emits semantic progress only from structured updates", () => {
    const adapterSource = readBridgeSource("../src/cursor-adapter.mjs");
    expectSourceContract(adapterSource, {
      required: [
        /--output-format[\s\S]*stream-json/,
        /type: "tool"/,
        /CLI-only/,
        /item\.semanticSummary/,
      ],
      forbidden: [
        /runViaSdk/,
        /await import\(["']@cursor\/sdk["']\)/,
        /estimateUsageFromCharCount\(/,
        /estimateUsageFromText\(/,
        /item\.snippet/,
      ],
    });

    const deprecated = estimateUsageMetrics(400);
    expect(deprecated).toEqual({ tokens: null, context: null });
    expect(formatAgentMetricsDetail(deprecated)).toBe("");
  });
});

describe("cursor-adapter activity formatting", () => {

  it("early_or_midflight_progress_does_not_invent_meter_ssot", () => {
    const adapterSource = readBridgeSource("../src/cursor-adapter.mjs");
    const cliPath = adapterSource.slice(adapterSource.indexOf("runCursorAgentStreaming"));

    expect(cliPath).not.toMatch(
      /formatAgentMetricsDetail\(estimateUsageFromText\(prompt,\s*""\)\)/,
    );
    expect(cliPath).not.toMatch(/estimateUsageFromCharCount\(/);
    expect(cliPath.indexOf('yield { type: "progress"')).toBeLessThan(
      cliPath.indexOf('type: "completed"'),
    );

    // AAAC helper still formats real meters only; empty when unavailable.
    expect(formatAaacAgentMetricsDetail({ tokens: null, context: null })).toBe("");
    expect(formatAgentMetricsDetail({ tokens: null, context: null })).toBe("");
  });

  it("phase-runner prefers deterministic checkpoint before LLM fallback", () => {
    const phaseRunnerSource = readBridgeSource("../src/phase-runner.mjs");
    expectSourceContract(phaseRunnerSource, {
      required: [
        /synthesizePhaseCheckpointDeterministic/,
        /Merging phase artifacts|Synthesizing phase artifacts/,
        /checkpoint: true/,
        /phase !== ["']report["']/,
        /LLM fallback/,
      ],
    });
  });

  it("phase-runner persists tool and semantic events through one contract", () => {
    const phaseRunnerSource = readBridgeSource("../src/phase-runner.mjs");
    expectSourceContract(phaseRunnerSource, {
      required: [/persistAgentPhaseEvent/, /createAgentPhaseEventPersistence/],
    });
  });

  it("agent runs never import Cursor SDK", () => {
    const adapterSource = readBridgeSource("../src/cursor-adapter.mjs");
    expectSourceContract(adapterSource, {
        required: [/runCursorAgentStreaming/, /resolveAaacPhaseModel/],
      forbidden: [
        /await import\(["']@cursor\/sdk["']\)/,
        /runViaSdk/,
        /\bAgent\.prompt\b/,
      ],
    });
  });
});

describe("cursor-auth", () => {
  it("getCursorAuthStatus is awaitable and returns shape", async () => {
    const pending = getCursorAuthStatus();
    expect(pending).toBeInstanceOf(Promise);
    const status = await pending;
    expect(status).toHaveProperty("loggedIn");
    expect(status).toHaveProperty("email");
  });

  it("isCursorAuthenticated matches status", async () => {
    const [authenticated, status] = await Promise.all([
      isCursorAuthenticated(),
      getCursorAuthStatus(),
    ]);
    expect(authenticated).toBe(status.loggedIn);
  });

  it("cursor-auth.mjs forbids spawnSync", () => {
    const authSource = readBridgeSource("../src/cursor-auth.mjs");
    expectSourceContract(authSource, {
      required: [
        /import\s*\{\s*spawn\s*\}\s*from\s*["']child_process["']/,
        /export async function getCursorAuthStatus/,
      ],
      // Comment may mention prior spawnSync result shape; forbid import/call only.
      forbidden: [/\bspawnSync\s*\(/, /import\s*\{[^}]*\bspawnSync\b/],
    });
  });
});

describe("cursor-models", () => {
  it("parseCursorModelsCliOutput maps ids and strips default suffix", async () => {
    const { parseCursorModelsCliOutput } = await import("../src/cursor-models.mjs");
    const stdout = `Available models

auto - Auto
composer-2.5 - Composer 2.5
composer-2.5-fast - Composer 2.5 Fast (current, default)
claude-sonnet-5-high - Sonnet 5 1M

Tip: use --model <id>`;

    const models = parseCursorModelsCliOutput(stdout);
    expect(models).toEqual([
      { id: "auto", pickerLabel: "Auto" },
      { id: "composer-2.5", pickerLabel: "Composer 2.5" },
      { id: "composer-2.5-fast", pickerLabel: "Composer 2.5 Fast", isDefault: true },
      { id: "claude-sonnet-5-high", pickerLabel: "Sonnet 5 1M" },
    ]);
  });

  it("listCursorModels is awaitable", async () => {
    const { listCursorModels } = await import("../src/cursor-models.mjs");
    const pending = listCursorModels();
    expect(pending).toBeInstanceOf(Promise);
    const result = await pending;
    expect(result).toHaveProperty("models");
    expect(result).toHaveProperty("source");
    expect(Array.isArray(result.models)).toBe(true);
  });

  it("cursor-models.mjs forbids spawnSync", () => {
    const modelsSource = readBridgeSource("../src/cursor-models.mjs");
    expectSourceContract(modelsSource, {
      required: [
        /import\s*\{\s*spawn\s*\}\s*from\s*["']child_process["']/,
        /export async function listCursorModels/,
      ],
      forbidden: [/\bspawnSync\s*\(/, /import\s*\{[^}]*\bspawnSync\b/],
    });
  });
});
describe("aaac workspace", () => {
  it("getAaacStatus returns ready for monorepo root", async () => {
    const { getAaacStatus } = await import("../src/aaac-status.mjs");
    const status = getAaacStatus(REPO_ROOT);
    expect(status.status).toBe("ready");
    expect(status.aaacRoot).toContain(".cursor/aaac");
  });

  it("getAaacStatus returns missing for empty temp dir", async () => {
    const { getAaacStatus } = await import("../src/aaac-status.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aos-aaac-"));
    try {
      const status = getAaacStatus(tmp);
      expect(status.status).toBe("missing");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("installAaacInWorkspace returns alreadyInstalled when ready", async () => {
    const { installAaacInWorkspace } = await import("../src/install-workspace.mjs");
    const result = await installAaacInWorkspace(REPO_ROOT);
    expect(result.ok).toBe(true);
    expect(result.alreadyInstalled).toBe(true);
  });
});
describe("agentic-bridge", () => {
  it("native and bridge child writers preserve records and recover stale locks", verifyConcurrentManifestWritersAndStaleLockRecovery);

  it("composePhasePrompt includes run context", () => {
    const prompt = composePhasePrompt(REPO_ROOT, {
      run_id: "run_test",
      command: "fix-module",
      domain: "cms",
      intent: "test intent",
      verb: "fix",
      phase_kind: "work",
      completed: [],
      pending: ["plan"],
    }, "discover");

    expect(prompt).toContain("run_test");
    expect(prompt).toContain("fix-module");
    expect(prompt).toContain("test intent");
    expect(prompt).toContain("`advance-phase.mjs`");
    expect(prompt).toContain("`run.json`");
  });
});

describe("agentic-bridge", () => {

  it("composeSwarmAgentPrompt directs agents away from checkpoint artifacts", () => {
    const prompt = composeSwarmAgentPrompt(
      REPO_ROOT,
      {
        run_id: "run_test",
        command: "check-app",
        intent: "test",
        verb: "check",
        phase_kind: "work",
      },
      "discover",
      0,
      3,
    );
    expect(prompt).toContain(".aaac/OUTPUT.md");
    expect(prompt).toContain("Do **not** write phase checkpoint artifacts");
    expect(prompt).toMatch(/graph-native|Repo vector graph packet/i);
    expect(prompt).toMatch(/request_context/i);
  });

  it("composeSwarmAgentPrompt includes agent spec path and content", () => {
    const agentSpec = {
      id: "discovery-inventory",
      relPath: "agents/discovery-inventory.md",
      cursorPath: ".cursor/agents/discovery-inventory.md",
    };
    const prompt = composeSwarmAgentPrompt(
      REPO_ROOT,
      {
        run_id: "run_test",
        command: "check-app",
        intent: "test",
        verb: "check",
        phase_kind: "work",
      },
      "discover",
      0,
      3,
      agentSpec,
    );
    expect(prompt).toContain("`.cursor/agents/discovery-inventory.md`");
    expect(prompt).toContain("Agent id: `discovery-inventory`");
    expect(prompt).toContain("Task prompt policy");
  });

  it("getSwarmAgentSpecs resolves check discover from graph", () => {
    const specs = getSwarmAgentSpecs(
      REPO_ROOT,
      { verb: "check", command: "check-app" },
      "discover",
      3,
    );
    expect(specs.map((s) => s.id)).toEqual([
      "discovery-inventory",
      "discovery-ssot",
      "check-capability-trace",
    ]);
  });
});

describe("agentic-bridge", () => {
  it(
    "Phase B: stream-json tool events meter files via recordAgentToolProgress",
    verifyPhaseBStreamJsonFileMetering,
    30_000,
  );
});

describe("agentic-bridge", () => {

  it(
    "recordAgentLaunch persists agent_spec_id and expected specs",
    async () => {
      const result = await dispatchRun(REPO_ROOT, '/review-module cms "Agent spec telemetry"');
      const agentSpec = {
        id: "discovery-inventory",
        path: ".cursor/agents/discovery-inventory.md",
        cursorPath: ".cursor/agents/discovery-inventory.md",
      };

      recordAgentLaunch(REPO_ROOT, result.run_id, {
        agentIndex: 0,
        phase: "discover",
        subagentType: "explore",
        description: "discovery-inventory",
        agentSpecId: "discovery-inventory",
        agentSpecPath: ".cursor/agents/discovery-inventory.md",
      });

      persistSwarmExpectedSpecs(REPO_ROOT, result.run_id, [agentSpec]);

      const manifest = readRunManifest(REPO_ROOT, result.run_id);
      expect(manifest.swarm.agents.at(-1)?.agent_spec_id).toBe("discovery-inventory");
      expect(manifest.swarm.agents.at(-1)?.agent_spec_path).toBe(
        ".cursor/agents/discovery-inventory.md",
      );
      expect(manifest.swarm.expected_agent_specs).toEqual([
        {
          id: "discovery-inventory",
          path: ".cursor/agents/discovery-inventory.md",
          initial_summary:
            "Find all files, routes, tests, and migrations belonging to the target domain.",
        },
      ]);

      fs.rmSync(path.join(REPO_ROOT, ".cursor/aaac/state/runs", result.run_id), {
        recursive: true,
        force: true,
      });
    },
    30_000,
  );

  it("composeSwarmCheckpointPrompt lists missing artifacts and swarm paths", () => {
    const prompt = composeSwarmCheckpointPrompt(
      REPO_ROOT,
      {
        run_id: "run_test",
        command: "check-app",
        intent: "test",
        verb: "check",
      },
      "discover",
      3,
      ["artifacts/discover_brief.yaml"],
    );
    expect(prompt).toContain("discover_brief.yaml");
    expect(prompt).toContain("discover_agent_1.md");
    expect(prompt).toContain("discover_agent_3.md");
    expect(prompt).toContain("orchestrator synthesis step");
  });
});

describe("agentic-bridge", () => {

  it("getSwarmTarget prefers manifest target_agents over recomputed floor", async () => {
    const { getSwarmTarget } = await import("../src/run-engine-loader.mjs");
    const tmpRunId = `run_test_swarm_target_${Date.now()}`;
    const runDir = path.join(REPO_ROOT, ".cursor/aaac/state/runs", tmpRunId);
    fs.mkdirSync(path.join(runDir, "artifacts"), { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "run.json"),
      JSON.stringify({
        run_id: tmpRunId,
        verb: "check",
        command: "check-architecture",
        phase: "validate",
        phase_kind: "gate",
        complexity: { scope_score: 3, change_score: null },
        swarm: {
          target_agents: { validate: 4 },
          task_launches_this_phase: 0,
          phase: "validate",
        },
      }),
    );

    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
      const target = await getSwarmTarget(REPO_ROOT, "validate", manifest, {
        runId: tmpRunId,
      });
      expect(target).toBe(4);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("refreshPhaseSwarmTarget updates gate target from scope score", async () => {
    const { refreshPhaseSwarmTarget, getSwarmTarget } = await import(
      "../src/run-engine-loader.mjs",
    );
    const tmpRunId = `run_test_refresh_target_${Date.now()}`;
    const runDir = path.join(REPO_ROOT, ".cursor/aaac/state/runs", tmpRunId);
    fs.mkdirSync(path.join(runDir, "artifacts"), { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "run.json"),
      JSON.stringify({
        run_id: tmpRunId,
        verb: "check",
        command: "check-architecture",
        phase: "validate",
        phase_kind: "gate",
        complexity: { scope_score: 17, change_score: null },
        swarm: {
          target_agents: { validate: 3 },
          task_launches_this_phase: 0,
          phase: "validate",
        },
      }),
    );

    try {
      const refreshed = await refreshPhaseSwarmTarget(REPO_ROOT, tmpRunId, "validate");
      expect(refreshed?.swarm?.target_agents?.validate).toBe(4);
      const target = await getSwarmTarget(REPO_ROOT, "validate", refreshed, {
        runId: tmpRunId,
      });
      expect(target).toBe(4);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe("agentic-bridge", () => {

  it("getMissingPhaseArtifacts returns absent gated files", async () => {
    const { getMissingPhaseArtifacts } = await import("../src/run-engine-loader.mjs");
    const tmpRunId = `run_test_missing_${Date.now()}`;
    const runDir = path.join(REPO_ROOT, ".cursor/aaac/state/runs", tmpRunId);
    fs.mkdirSync(path.join(runDir, "artifacts"), { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "run.json"),
      JSON.stringify({
        run_id: tmpRunId,
        verb: "check",
        command: "check-app",
        phase: "discover",
      }),
    );

    try {
      const missing = await getMissingPhaseArtifacts(
        REPO_ROOT,
        tmpRunId,
        "discover",
        { verb: "check", command: "check-app" },
      );
      expect(missing).toContain("artifacts/discover_brief.yaml");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("prompt-compose.mjs passes syntax check", () => {
    const promptComposePath = path.resolve(import.meta.dirname, "../src/prompt-compose.mjs");
    const result = spawnSync("node", ["--check", promptComposePath], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  it("listRuns returns array", async () => {
    const runs = await listRuns(REPO_ROOT);
    expect(Array.isArray(runs)).toBe(true);
  });

  it("runEngineScript returns a Promise", async () => {
    const pending = runEngineScript(REPO_ROOT, "list-runs.mjs", ["--json"]);
    expect(pending).toBeInstanceOf(Promise);
    const result = await pending;
    expect(result).toMatchObject({ ok: expect.any(Boolean), status: expect.any(Number) });
    expect(typeof result.stdout).toBe("string");
  });

  it(
    "runEngineScript times out and kills hung child within bound",
    async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-timeout-"));
      const runEngineDir = path.join(tmp, ".cursor/aaac/scripts/run-engine");
      fs.mkdirSync(runEngineDir, { recursive: true });
      const hangScript = path.join(runEngineDir, "hang-forever.mjs");
      fs.writeFileSync(
        hangScript,
        "setInterval(() => {}, 60_000);\n",
        "utf8",
      );

      const timeoutMs = 250;
      const started = Date.now();
      try {
        const result = await runEngineScript(tmp, "hang-forever.mjs", [], {
          timeoutMs,
        });
        const elapsed = Date.now() - started;

        expect(result.ok).toBe(false);
        expect(result.status).toBeNull();
        expect(result.stderr).toBe(`runEngineScript timed out after ${timeoutMs}ms`);
        // Settle on timeout; SIGKILL grace is 2s — stay well under a hung default.
        expect(elapsed).toBeLessThan(timeoutMs + 3_000);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
    10_000,
  );

  it("paths.mjs runEngineScript uses spawn not spawnSync", () => {
    const pathsSource = readBridgeSource("../src/paths.mjs");
    expectSourceContract(pathsSource, {
      required: [
        /import\s*\{\s*spawn\s*\}\s*from\s*["']child_process["']/,
        /const child = spawn\(/,
        /timeoutMs/,
        /child\.kill\(["']SIGTERM["']\)/,
      ],
      forbidden: [/spawnSync/],
    });
  });
});

describe("agentic-bridge", () => {

  it(
    "listAaocCommands returns registry commands",
    async () => {
      const { listAaocCommands, normalizeAaocPrompt } = await import("../src/commands.mjs");
      const { recordAgentLaunch, failRun } = await import("../src/run-manifest.mjs");
      const { commands, aliases } = listAaocCommands(REPO_ROOT);
      expect(commands).toContain("fix-module");
      expect(aliases).toContain("module-fix");
      expect(normalizeAaocPrompt("/ fix-module cms \"x\"")).toBe('/fix-module cms "x"');

      const result = await dispatchRun(REPO_ROOT, '/review-module cms "Record agent test"');
      const updated = recordAgentLaunch(REPO_ROOT, result.run_id, {
        agentIndex: 0,
        phase: "discover",
      });
      expect(updated.swarm.task_launches_this_phase).toBe(1);

      failRun(REPO_ROOT, result.run_id, "test cleanup");
      expect(readRunManifest(REPO_ROOT, result.run_id).status).toBe("failed");

      fs.rmSync(path.join(REPO_ROOT, ".cursor/aaac/state/runs", result.run_id), {
        recursive: true,
        force: true,
      });
    },
    30_000,
  );

  it(
    "dispatchRun creates manifest",
    async () => {
      const result = await dispatchRun(
        REPO_ROOT,
        '/review-module cms "Smoke test dispatch"',
      );

      expect(result.ok).toBe(true);
      expect(result.run_id).toMatch(/^run_/);
      expect(result.session_id).toMatch(/^aos_/);

      const manifest = readRunManifest(REPO_ROOT, result.run_id);
      expect(manifest).toBeTruthy();
      expect(manifest.origin).toBe("agentic-os");
      expect(manifest.command).toBe("review-module");

      fs.rmSync(path.join(REPO_ROOT, ".cursor/aaac/state/runs", result.run_id), {
        recursive: true,
        force: true,
      });
    },
    30_000,
  );
});

describe("agentic-bridge", () => {

  it(
    "RunWatcher emits run.created",
    async () => {
      const result = await dispatchRun(
        REPO_ROOT,
        '/review-module cms "Watcher test"',
      );

      const watcher = new RunWatcher(REPO_ROOT);
      const events = [];

      watcher.on("event", (e) => events.push(e));
      watcher.watchRun(result.run_id);

      await new Promise((r) => setTimeout(r, 200));

      expect(events.some((e) => e.type === "run.created" || e.type === "run.updated")).toBe(true);

      watcher.close();
      fs.rmSync(path.join(REPO_ROOT, ".cursor/aaac/state/runs", result.run_id), {
        recursive: true,
        force: true,
      });
    },
    30_000,
  );
});
