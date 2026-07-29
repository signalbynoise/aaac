import { spawn } from "child_process";
import { createLogger } from "./logger.mjs";
import { composePhasePrompt } from "./prompt-compose.mjs";
import { isCursorAuthenticated, resolveCursorBin } from "./cursor-auth.mjs";
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

const log = createLogger("agentic-bridge:cursor-adapter");

export function formatAdapterStartedDetail(ctx) {
  const payload = {
    phase: ctx.phase,
    adapter: "cursor-local",
    origin: "agentic-os",
    started_at: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

function runCursorAgentStreaming(workspaceRoot, prompt, timeoutMs = 900_000) {
  const bin = resolveCursorBin();
  if (!bin) {
    throw new Error("cursor agent binary not found — install Cursor or run Sign in with Cursor");
  }

  if (!isCursorAuthenticated()) {
    throw new Error("Not signed in to Cursor — use Sign in with Cursor in Agentic OS");
  }

  const modelId = process.env.CURSOR_MODEL?.trim() || "composer-2.5";
  // stream-json emits tool_call NDJSON for Phase B metering (text format cannot).
  const args = [
    "agent",
    "-p",
    "-f",
    "--trust",
    "--approve-mcps",
    "--output-format",
    "stream-json",
    "--model",
    modelId,
  ];
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (apiKey) {
    args.push("--api-key", apiKey);
  }
  args.push(prompt);

  log.info("cursor-cli", "Invoking cursor agent (stream-json)", {
    cwd: workspaceRoot,
    model: modelId,
    api_key: Boolean(apiKey),
  });

  const child = spawn(bin, args, {
    cwd: workspaceRoot,
    env: { ...process.env, CI: process.env.CI ?? "1", CURSOR_MODEL: modelId },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return { child, timeoutMs };
}

/**
 * Stream child stdout as Phase B events: tool / progress / completed payload.
 * Yields { kind: 'tool'|'progress' } while running; return value is completed result.
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

function attachChildOutputListeners(child, state, timeoutMs) {
  const timer = setTimeout(() => {
    clearTimeout(timer);
    child.kill("SIGTERM");
    state.error = new Error(`cursor agent timed out after ${timeoutMs}ms`);
    state.done = true;
    wakeOutput(state);
  }, timeoutMs);
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    state.stdout += text;
    for (const line of state.lineBuffer.push(text)) {
      handleParsedOutput(state, parseStreamJsonLine(line));
    }
  });
  child.stderr.on("data", (chunk) => (state.stderr += String(chunk)));
  child.on("error", (err) => {
    state.error = err;
    state.done = true;
    clearTimeout(timer);
    wakeOutput(state);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    completeChildOutput(state, code);
  });
}

async function* streamChildOutput(child, timeoutMs) {
  const state = createOutputState();
  attachChildOutputListeners(child, state, timeoutMs);
  while (!state.done || state.queue.length > 0) {
    while (state.queue.length > 0) {
      yield state.queue.shift();
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

async function spawnAgentWithRetry(ctx, prompt) {
  let spawned;
  await withCursorCliRetry(async () => {
    spawned = runCursorAgentStreaming(ctx.workspaceRoot, prompt);
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
  const prompt = ctx.prompt ?? composePhasePrompt(ctx.workspaceRoot, ctx.manifest, ctx.phase);
  try {
    const completed = await withCursorCliRetry(async () => {
      const { child, timeoutMs } = await spawnAgentWithRetry(ctx, prompt);
      activeChildren.set(ctx.runId, child);
      try {
        const stream = streamChildOutput(child, timeoutMs);
        const events = [];
        let next = await stream.next();
        while (!next.done) {
          const event = toPhaseStreamEvent(ctx, next.value);
          if (event?.type === "tool" || event?.semanticSummary) events.push(event);
          next = await stream.next();
        }
        if (!next.value) throw new Error("cursor agent produced no output");
        // Surface keychain failures that arrived as child errors
        if (next.value?.error && isKeychainAuthError(next.value.error)) {
          throw next.value.error;
        }
        return { events, result: next.value };
      } finally {
        activeChildren.delete(ctx.runId);
      }
    }, { maxAttempts: 4, baseBackoffMs: 2000 });

    for (const event of completed.events) yield event;
    yield normalizePhaseEvent({
      runId: ctx.runId,
      type: "completed",
      phase: ctx.phase,
      agentIndex: ctx.agentIndex,
      cursorRunId: completed.result.cursorRunId,
      finalSummary: validateSealedSummary(completed.result.finalSummary),
      metrics: completed.result.metrics,
    });
  } catch (err) {
    activeChildren.delete(ctx.runId);
    log.error("cursor-adapter", "Phase execution failed", {
      runId: ctx.runId,
      phase: ctx.phase,
      error: String(err),
    });
    yield { type: "failed", phase: ctx.phase, detail: String(err) };
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
