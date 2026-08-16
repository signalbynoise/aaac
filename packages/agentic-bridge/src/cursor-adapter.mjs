import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { createLogger } from "./logger.mjs";
import { composePhasePrompt } from "./prompt-compose.mjs";
import { isCursorAuthenticated, resolveCursorBin, cursorAgentArgv } from "./cursor-auth.mjs";
import {
  filterCursorCliStderr,
  hasSubstantiveCursorCliOutput,
  withCursorCliRetry,
  isKeychainAuthError,
} from "./cursor-cli-noise.mjs";
import {
  createStreamJsonLineBuffer,
  parseStreamJsonLine,
} from "./stream-json-tools.mjs";
import {
  accumulateCursorUsage,
  createCursorUsageAccumulator,
  cursorUsageMetrics,
} from "./cursor-usage.mjs";
import { normalizePhaseEvent } from "./phase-event-contract.mjs";
import {
  validateCurrentStep,
  validateInitialSummary,
  validateSealedSummary,
} from "@ludecker/aaac/run-engine/agent-progress-contract";
import {
  evaluateToolAccess,
  budgetsFromPhaseContext,
  FINDING_TOOLS,
} from "@ludecker/aaac/run-engine/evaluate-finding-tools";
import { resolveWorkspacePaths } from "./paths.mjs";
import { DEFAULT_AAAC_MODEL_SLUG, resolveAaacPhaseModel, toCursorCliModelSlug } from "./aaac-model.mjs";
import { writeCliLatestSidecarAt } from "@ludecker/aaac/run-engine/resolve-run-id";
import {
  shouldUseWorkerCapsule,
  materializeWorkerCapsule,
  writeCapsuleMcpConfig,
  collectCapsuleOutput,
  stripWorkspacePathFromText,
} from "@ludecker/aaac/run-engine/worker-capsule";
import { assertWorkerSandbox, sandboxSpawnArgv } from "@ludecker/aaac/run-engine/worker-sandbox";
import { createContextBroker } from "@ludecker/aaac/run-engine/context-broker";

const log = createLogger("agentic-bridge:cursor-adapter");

function resolveAgentTimeoutMs(fallback = 900_000) {
  const n = Number(process.env.AAAC_AGENT_TIMEOUT_MS ?? process.env.CURSOR_AGENT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function resolveAgentIdleMs(fallback = 180_000) {
  const n = Number(process.env.AAAC_AGENT_IDLE_MS ?? process.env.CURSOR_AGENT_IDLE_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function formatAdapterStartedDetail(ctx) {
  const payload = {
    phase: ctx.phase,
    adapter: "cursor-local",
    origin: "agentic-os",
    started_at: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

function loadPhaseContextForRun(workspaceRoot, runId) {
  const { runsRoot } = resolveWorkspacePaths(workspaceRoot);
  const pcPath = path.join(runsRoot, runId, "artifacts", "phase_context.json");
  if (!fs.existsSync(pcPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pcPath, "utf8"));
  } catch {
    return null;
  }
}

function loadManifestForRun(workspaceRoot, runId) {
  const { runsRoot } = resolveWorkspacePaths(workspaceRoot);
  const p = path.join(runsRoot, runId, "run.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function agentCountersFromManifest(manifest, phase, agentIndex) {
  const agents = manifest?.swarm?.agents ?? [];
  const match =
    agentIndex != null
      ? agents.find(
          (a) => a.phase === phase && Number(a.index) === Number(agentIndex),
        )
      : [...agents].reverse().find((a) => a.phase === phase && !a.completed_at);
  if (!match) return { files_read: 0, full_file_opens: 0, gap_searches: 0 };
  return {
    files_read: Number(match.files_read) || 0,
    full_file_opens: Number(match.full_file_opens) || 0,
    gap_searches: Number(match.gap_searches) || 0,
  };
}

function workerEnvForSpawn(modelId, envExtras, { capsule = false } = {}) {
  const env = {
    ...process.env,
    CI: process.env.CI ?? "1",
    CURSOR_MODEL: modelId,
    ...envExtras,
  };
  if (capsule) {
    delete env.AAAC_WORKSPACE_ROOT;
  }
  return env;
}

async function runCursorAgentStreaming(workspaceRoot, prompt, timeoutMs = resolveAgentTimeoutMs(), envExtras = {}, spawnOpts = {}) {
  const bin = await resolveCursorBin();
  if (!bin) {
    throw new Error("cursor agent binary not found — install Cursor or run Sign in with Cursor");
  }

  if (!(await isCursorAuthenticated())) {
    throw new Error("Not signed in to Cursor — use Sign in with Cursor in Agentic OS");
  }

  const modelId = toCursorCliModelSlug(envExtras.CURSOR_MODEL?.trim() || DEFAULT_AAAC_MODEL_SLUG);
  const cwd = spawnOpts.cwd ?? workspaceRoot;
  const workspaceFlag = spawnOpts.workspaceDir ?? cwd;
  const agentArgs = [
    "-p",
    "-f",
    "--trust",
    "--approve-mcps",
    "--workspace",
    workspaceFlag,
    "--output-format",
    "stream-json",
    "--model",
    modelId,
  ];
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (apiKey) {
    agentArgs.push("--api-key", apiKey);
  }
  agentArgs.push(prompt);
  const args = cursorAgentArgv(bin, agentArgs);
  const env = workerEnvForSpawn(modelId, envExtras, { capsule: Boolean(spawnOpts.capsule) });

  log.info("cursor-cli", "Invoking cursor agent (stream-json)", {
    cwd,
    workspace: workspaceFlag,
    capsule: Boolean(spawnOpts.capsule),
    model: modelId,
    api_key: Boolean(apiKey),
    bin,
    aaac_run_id: envExtras.AAAC_RUN_ID ?? null,
  });

  let child;
  if (spawnOpts.sandboxLauncher) {
    const wrapped = sandboxSpawnArgv(spawnOpts.sandboxLauncher, bin, args);
    child = spawn(wrapped.cmd, wrapped.args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    child = spawn(bin, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  const idleMs = resolveAgentIdleMs();
  return { child, timeoutMs, idleMs };
}

/**
 * Stream child stdout as Phase B events: tool / progress / completed payload.
 * Yields live while running so metering is not post-exit-only.
 * Agent runs are CLI-only (stream-json) — no silent SDK runner.
 */
function createOutputState() {
  return {
    queue: [],
    stdout: "",
    stderr: "",
    done: false,
    error: null,
    resolveWait: null,
    resultText: "",
    finalSummary: null,
    sessionId: null,
    seenCallIds: new Set(),
    usage: createCursorUsageAccumulator(),
    lineBuffer: createStreamJsonLineBuffer(),
  };
}

function wakeOutput(state) {
  state.resolveWait?.();
  state.resolveWait = null;
}

function enqueueOutput(state, item) {
  state.queue.push(item);
  wakeOutput(state);
}

function handleToolOutput(state, parsed) {
  const callId = parsed.callId ?? `${parsed.toolName}:${parsed.path ?? ""}`;
  if (state.seenCallIds.has(callId)) return;
  state.seenCallIds.add(callId);
  enqueueOutput(state, {
    kind: "tool",
    toolName: parsed.toolName,
    path: parsed.path,
    arguments: parsed.arguments,
    callId: parsed.callId,
  });
  if (parsed.toolName !== "UpdateCurrentStep") return;
  if (parsed.arguments?.current_step) {
    enqueueOutput(state, { kind: "progress", semanticSummary: parsed.arguments.current_step });
  }
  if (parsed.arguments?.final_summary) state.finalSummary = parsed.arguments.final_summary;
}

function handleParsedOutput(state, parsed) {
  if (!parsed) return;
  if (parsed.kind === "tool") return handleToolOutput(state, parsed);
  if (parsed.kind === "usage") {
    accumulateCursorUsage(state.usage, parsed);
    return;
  }
  if (parsed.kind !== "result") return;
  state.resultText = parsed.text || state.resultText;
  state.sessionId = parsed.sessionId ?? state.sessionId;
}

function completeChildOutput(state, code) {
  for (const line of state.lineBuffer.flush()) {
    handleParsedOutput(state, parseStreamJsonLine(line));
  }
  const exitCode = code ?? 1;
  if (!state.error && exitCode !== 0) {
    const message = filterCursorCliStderr(state.stderr);
    if (message || !hasSubstantiveCursorCliOutput(state.stdout)) {
      state.error = new Error(message || `cursor agent exited ${exitCode}`);
    } else {
      log.warn("cursor-cli", "Non-zero exit ignored; substantive stdout present", {
        exitCode,
        stdoutChars: state.stdout.length,
        stderrChars: state.stderr.length,
      });
    }
  }
  state.done = true;
  wakeOutput(state);
}

function attachChildOutputListeners(child, state, timeoutMs, idleMs = resolveAgentIdleMs()) {
  const clearTimers = () => {
    if (state.absoluteTimer) clearTimeout(state.absoluteTimer);
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.absoluteTimer = null;
    state.idleTimer = null;
  };

  const fail = (message) => {
    if (state.done) return;
    clearTimers();
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    state.error = new Error(message);
    state.done = true;
    wakeOutput(state);
  };

  const touchIdle = () => {
    state.lastActivityAt = Date.now();
    if (state.idleTimer) clearTimeout(state.idleTimer);
    if (!(idleMs > 0) || state.done) return;
    state.idleTimer = setTimeout(() => {
      fail(`cursor agent stalled (no response for ${idleMs}ms)`);
    }, idleMs);
  };

  state.absoluteTimer = setTimeout(() => {
    fail(`cursor agent timed out after ${timeoutMs}ms`);
  }, timeoutMs);
  touchIdle();

  child.stdout.on("data", (chunk) => {
    touchIdle();
    const text = String(chunk);
    state.stdout += text;
    for (const line of state.lineBuffer.push(text)) {
      handleParsedOutput(state, parseStreamJsonLine(line));
    }
  });
  child.stderr.on("data", (chunk) => {
    touchIdle();
    state.stderr += String(chunk);
  });
  child.on("error", (err) => {
    clearTimers();
    state.error = err;
    state.done = true;
    wakeOutput(state);
  });
  child.on("close", (code) => {
    clearTimers();
    completeChildOutput(state, code);
  });
}

async function* streamChildOutput(child, timeoutMs, idleMs = resolveAgentIdleMs()) {
  const state = createOutputState();
  attachChildOutputListeners(child, state, timeoutMs, idleMs);
  while (!state.done || state.queue.length > 0) {
    while (state.queue.length > 0) {
      yield { item: state.queue.shift(), state };
    }
    if (state.done) break;
    await new Promise((resolve) => {
      state.resolveWait = resolve;
    });
  }
  if (state.error) throw state.error;
  return {
    cursorRunId: state.sessionId,
    output: state.resultText || state.stdout,
    finalSummary: state.finalSummary,
    metrics: cursorUsageMetrics(state.usage),
  };
}

function toPhaseStreamEvent(ctx, item) {
  if (item?.kind === "tool") {
    return {
      type: "tool",
      phase: ctx.phase,
      toolName: item.toolName,
      path: item.path ?? null,
      arguments: item.arguments ?? null,
      callId: item.callId ?? null,
    };
  }
  if (item?.kind !== "progress") return null;
  return normalizePhaseEvent({
    runId: ctx.runId,
    type: "progress",
    phase: ctx.phase,
    agentIndex: ctx.agentIndex,
    semanticSummary: validateCurrentStep(item.semanticSummary),
  });
}

/**
 * Observe unauthorized finding tools on CLI. Prefer preToolUse deny so the
 * agent stays alive and can still write artifacts — never SIGTERM here
 * (killing mid-phase drops plan_agent_*.md and fails the checkpoint).
 */
function maybeLogUnauthorizedFinding(ctx, toolEvent) {
  if (!toolEvent || toolEvent.type !== "tool") return;
  if (!FINDING_TOOLS.test(toolEvent.toolName ?? "")) return;

  const phaseContext = loadPhaseContextForRun(ctx.workspaceRoot, ctx.runId);
  const manifest = loadManifestForRun(ctx.workspaceRoot, ctx.runId);
  const counters = agentCountersFromManifest(
    manifest,
    ctx.phase,
    ctx.agentIndex,
  );
  const budgets = budgetsFromPhaseContext(phaseContext);
  const decision = evaluateToolAccess({
    toolName: toolEvent.toolName,
    toolInput: toolEvent.arguments ?? { path: toolEvent.path },
    phaseContext,
    budgets,
    counters,
  });
  if (decision.allow) return;

  log.warn("finding-gate", "Unauthorized finding tool observed (agent kept alive)", {
    runId: ctx.runId,
    toolName: toolEvent.toolName,
    reason: decision.reason,
    message: decision.message,
  });
}

async function spawnAgentWithRetry(ctx, prompt, envExtras, spawnOpts = {}) {
  let spawned;
  await withCursorCliRetry(async () => {
    spawned = await runCursorAgentStreaming(
      ctx.workspaceRoot,
      prompt,
      resolveAgentTimeoutMs(),
      envExtras,
      spawnOpts,
    );
  }, { maxAttempts: 2, baseBackoffMs: 2000 });
  return spawned;
}

async function* runAdapterPhase(ctx, cancelled, activeChildren) {
  if (cancelled.has(ctx.runId)) {
    yield { type: "failed", phase: ctx.phase, detail: "cancelled" };
    return;
  }
  yield normalizePhaseEvent({
    runId: ctx.runId,
    type: "started",
    phase: ctx.phase,
    agentIndex: ctx.agentIndex,
    initialSummary: validateInitialSummary(ctx.initialSummary),
  });
  const useCapsule = shouldUseWorkerCapsule(ctx.manifest, ctx.workerKind ?? "swarm");
  let prompt = ctx.prompt ?? composePhasePrompt(ctx.workspaceRoot, ctx.manifest, ctx.phase);
  let spawnOpts = {};
  let broker = null;
  if (useCapsule) {
    try {
      const phaseContext = loadPhaseContextForRun(ctx.workspaceRoot, ctx.runId);
      const capsule = materializeWorkerCapsule({
        workspaceRoot: ctx.workspaceRoot,
        runId: ctx.runId,
        agentIndex: ctx.agentIndex ?? 0,
        phaseContext,
        manifest: ctx.manifest,
        phase: ctx.phase,
      });
      broker = createContextBroker({
        workspaceRoot: ctx.workspaceRoot,
        runId: ctx.runId,
        manifest: ctx.manifest,
        capsuleDir: capsule.capsuleDir,
        agentIndex: ctx.agentIndex ?? 0,
        phase: ctx.phase,
      });
      const { url } = await broker.listen();
      writeCapsuleMcpConfig(capsule.capsuleDir, url);
      const { launcher } = assertWorkerSandbox({
        capsuleDir: capsule.capsuleDir,
        workspaceRoot: ctx.workspaceRoot,
      });
      spawnOpts = {
        cwd: capsule.capsuleDir,
        workspaceDir: capsule.capsuleDir,
        capsule: true,
        sandboxLauncher: launcher,
        capsuleDir: capsule.capsuleDir,
      };
      prompt = stripWorkspacePathFromText(prompt, ctx.workspaceRoot);
      log.info("capsule", "Check worker isolated in grant capsule", {
        runId: ctx.runId,
        agentIndex: ctx.agentIndex,
        capsuleDir: capsule.capsuleDir,
        granted: capsule.copied.length,
        skipped: capsule.skipped.length,
        broker: url,
      });
    } catch (err) {
      if (broker) {
        try {
          await broker.close();
        } catch {
          // ignore
        }
        broker = null;
      }
      throw err;
    }
  }
  const modelId = await resolveAaacPhaseModel(ctx.workspaceRoot, {
    phase: ctx.phase,
    agentSpecId: ctx.agentSpec?.id ?? null,
    subagentType: ctx.subagentType ?? null,
  });
  const envExtras = {
    AAAC_RUN_ID: ctx.runId,
    AAAC_SESSION_ID: ctx.manifest?.session_id ?? process.env.AAAC_SESSION_ID ?? "",
    AAAC_AGENT_INDEX:
      ctx.agentIndex != null && ctx.agentIndex >= 0 ? String(ctx.agentIndex) : "",
    CURSOR_MODEL: modelId,
  };
  if (useCapsule) {
    envExtras.AAAC_CAPSULE = "1";
  }
  try {
    writeCliLatestSidecarAt(ctx.workspaceRoot, {
      run_id: ctx.runId,
      session_id: envExtras.AAAC_SESSION_ID || null,
      agent_index: ctx.agentIndex,
      phase: ctx.phase,
    });
  } catch (err) {
    log.warn("cli-sidecar", "Failed to write cli-latest.json", {
      runId: ctx.runId,
      error: String(err?.message ?? err),
    });
  }

  const maxAttempts = 4;
  let lastError = null;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (cancelled.has(ctx.runId)) {
        yield { type: "failed", phase: ctx.phase, detail: "cancelled" };
        return;
      }
      let child = null;
      try {
        const spawned = await spawnAgentWithRetry(ctx, prompt, envExtras, spawnOpts);
        child = spawned.child;
        const timeoutMs = spawned.timeoutMs;
        activeChildren.set(ctx.runId, child);

        const stream = streamChildOutput(child, timeoutMs, spawned.idleMs);
        let next = await stream.next();
        while (!next.done) {
          const { item } = next.value;
          const event = toPhaseStreamEvent(ctx, item);
          if (event?.type === "tool") {
            maybeLogUnauthorizedFinding(ctx, event);
          }
          if (event?.type === "tool" || event?.semanticSummary) {
            yield event;
          }
          next = await stream.next();
        }
        const result = next.value ?? {
          cursorRunId: null,
          output: "",
          finalSummary: null,
          metrics: {},
        };
        let collected = { ok: false };
        if (useCapsule && spawnOpts.capsuleDir) {
          collected = collectCapsuleOutput({
            capsuleDir: spawnOpts.capsuleDir,
            workspaceRoot: ctx.workspaceRoot,
            runId: ctx.runId,
            phase: ctx.phase,
            agentIndex: ctx.agentIndex ?? 0,
          });
        }
        if (!result.output && !result.finalSummary && !result.cursorRunId && !collected.ok) {
          throw new Error("cursor agent produced no output");
        }
        activeChildren.delete(ctx.runId);
        yield normalizePhaseEvent({
          runId: ctx.runId,
          type: "completed",
          phase: ctx.phase,
          agentIndex: ctx.agentIndex,
          cursorRunId: result.cursorRunId,
          finalSummary: validateSealedSummary(result.finalSummary),
          metrics: result.metrics,
        });
        return;
      } catch (err) {
        activeChildren.delete(ctx.runId);
        lastError = err;
        if (isKeychainAuthError(err)) break;
        const backoff = 2000 * attempt;
        log.warn("cursor-adapter", "Agent attempt failed; retrying", {
          runId: ctx.runId,
          attempt,
          error: String(err),
          backoffMs: backoff,
        });
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
      }
    }

    log.error("cursor-adapter", "Phase execution failed", {
      runId: ctx.runId,
      phase: ctx.phase,
      error: String(lastError),
    });
    yield { type: "failed", phase: ctx.phase, detail: String(lastError) };
  } finally {
    if (broker) {
      try {
        await broker.close();
      } catch {
        // ignore
      }
    }
  }
}

function cancelAdapterRun(runId, cancelled, activeChildren) {
  cancelled.add(runId);
  activeChildren.get(runId)?.kill("SIGTERM");
  log.info("cancel", "Run cancellation requested", { runId });
}

/** @returns {import('./adapters/execution-adapter.mjs').ExecutionAdapter} */
export function createCursorLocalAdapter() {
  const cancelled = new Set();
  const activeChildren = new Map();
  return {
    id: "cursor-local",
    runPhase: (ctx) => runAdapterPhase(ctx, cancelled, activeChildren),
    cancel: async (runId) => cancelAdapterRun(runId, cancelled, activeChildren),
  };
}
