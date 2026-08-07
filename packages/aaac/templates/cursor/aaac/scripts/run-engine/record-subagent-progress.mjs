#!/usr/bin/env node
import path from "path";
import {
  loadActiveRun,
  runDir,
  conversationIdFromHook,
} from "./lib.mjs";
import { recordLog } from "./log.mjs";
import {
  applyAgentFinalSummaryCandidate,
  applyAgentSemanticProgress,
  applyAgentToolProgress,
  findAgentArrayIndexBySubagentId,
  normalizeSubagentId,
} from "./agent-progress-contract.mjs";
import { mutateAgentManifest } from "./swarm-telemetry.mjs";
import {
  resolveConversationContextMetrics,
  applyConversationContextMetrics,
} from "./conversation-context.mjs";

function applyHookProgress(manifest, hook, conversationId) {
  if (
    ["completed", "cancelled"].includes(manifest.status) ||
    (manifest.conversation_id && manifest.conversation_id !== conversationId)
  ) return;
  const subagentId = normalizeSubagentId(hook.subagent_id ?? hook.subagentId);
  if (
    !subagentId ||
    findAgentArrayIndexBySubagentId(manifest, manifest.phase, subagentId) == null
  ) return;
  const contextMetrics = resolveConversationContextMetrics(hook);
  if (contextMetrics) applyConversationContextMetrics(manifest, contextMetrics, "postToolUse");
  applyAgentToolProgress(manifest, {
    phase: manifest.phase,
    hook,
    filesSource: "metered_hook",
  });
  const inputArgs = hook.tool_input ?? hook.toolInput ?? hook.arguments ?? {};
  const isStepUpdate = String(hook.tool_name ?? hook.toolName ?? "")
    .endsWith("UpdateCurrentStep");
  applyAgentFinalSummaryCandidate(manifest, {
    phase: manifest.phase,
    subagentId,
    finalSummary: isStepUpdate
      ? inputArgs.final_summary ?? inputArgs.finalSummary
      : null,
  });
  const progress = applyAgentSemanticProgress(manifest, {
    phase: manifest.phase,
    subagentId,
    currentStep: isStepUpdate
      ? inputArgs.current_step ?? inputArgs.currentStep
      : null,
  });
  if (!progress.applied) return;
  const phaseSlot =
    manifest.swarm.agents[progress.arrayIndex]?.index ?? progress.arrayIndex + 1;
  recordLog(manifest, {
    event: "agent_progress",
    phase: manifest.phase,
    phase_kind: manifest.phase_kind,
    detail: JSON.stringify({
      agent_index: phaseSlot,
      semantic_summary: progress.summary,
    }),
    level: "debug",
  });
}

function reportHookFailure(error, context = {}) {
  console.error(JSON.stringify({
    level: "error",
    module: "aaac-hook",
    operation: "record-subagent-progress",
    message: "Failed to record subagent progress; allowing hook",
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
      applyHookProgress(manifest, hook, conversationId);
    });
  } catch (error) {
    reportHookFailure(error, {
      conversation_id: conversationId,
      run_id: active?.run_id ?? null,
    });
  }
  allow();
});
