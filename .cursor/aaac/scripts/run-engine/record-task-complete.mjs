#!/usr/bin/env node
import path from "path";
import {
  loadActiveRun,
  runDir,
  saveActiveRun,
  conversationIdFromHook,
} from "./lib.mjs";
import {
  normalizeSubagentId,
} from "./agent-progress-contract.mjs";
import {
  applyAgentComplete,
  mutateAgentManifest,
} from "./swarm-telemetry.mjs";

function finiteMetric(value) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

function removeActiveCodeEditor(manifest, subagentId) {
  if (!subagentId || !Array.isArray(manifest.swarm?.active_code_editors)) return;
  manifest.swarm.active_code_editors = manifest.swarm.active_code_editors.filter(
    (editor) => normalizeSubagentId(editor.subagent_id) !== subagentId,
  );
}

function completionAgentIndex(hook) {
  const rawIndex =
    hook.agent_index ?? hook.agentIndex ?? hook.launch_index ?? hook.launchIndex;
  const agentIndex = rawIndex != null ? Number(rawIndex) - 1 : undefined;
  return Number.isFinite(agentIndex) ? agentIndex : undefined;
}

function applyHookCompletion(manifest, hook, conversationId) {
  if (
    ["completed", "cancelled"].includes(manifest.status) ||
    (manifest.conversation_id && manifest.conversation_id !== conversationId)
  ) return;

  const subagentId = normalizeSubagentId(hook.subagent_id ?? hook.subagentId);
  removeActiveCodeEditor(manifest, subagentId);
  applyAgentComplete(manifest, {
    agentIndex: completionAgentIndex(hook),
    subagentId,
    phase: manifest.phase,
    finalSummary: hook.final_summary ?? hook.finalSummary ?? null,
    cursorRunId: hook.cursor_run_id ?? hook.cursorRunId ?? null,
    tokens: finiteMetric(hook.tokens ?? hook.token_count ?? hook.tokenCount),
    context: finiteMetric(hook.context ?? hook.context_score ?? hook.contextScore),
  });
}

function reportHookFailure(error, context = {}) {
  console.error(JSON.stringify({
    level: "error",
    module: "aaac-hook",
    operation: "record-task-complete",
    message: "Failed to seal subagent completion; allowing hook",
    ...context,
    error: error instanceof Error ? error.message : String(error),
  }));
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const allow = () => {
    console.log(JSON.stringify({ permission: "allow" }));
    process.exit(0);
  };
  let hook;
  try {
    hook = JSON.parse(input || "{}");
  } catch {
    allow();
  }
  const conversationId = conversationIdFromHook(hook);
  if (!conversationId) allow();
  let active;
  try {
    active = loadActiveRun(conversationId);
    if (!active?.run_id) allow();
    mutateAgentManifest(path.join(runDir(active.run_id), "run.json"), (manifest) => {
      applyHookCompletion(manifest, hook, conversationId);
    });
    saveActiveRun(conversationId, active);
  } catch (error) {
    reportHookFailure(error, {
      conversation_id: conversationId,
      run_id: active?.run_id ?? null,
    });
  }
  allow();
});
