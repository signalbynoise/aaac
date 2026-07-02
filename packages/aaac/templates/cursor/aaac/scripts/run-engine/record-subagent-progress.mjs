#!/usr/bin/env node
import path from "path";
import {
  loadActiveRun,
  loadRunManifest,
  runDir,
  writeJson,
  conversationIdFromHook,
} from "./lib.mjs";
import { recordLog } from "./log.mjs";
import {
  findAgentArrayIndexBySubagentId,
  findAgentIndexToComplete,
  formatHookProgressSummary,
} from "./swarm-telemetry.mjs";
import {
  resolveConversationContextMetrics,
  applyConversationContextMetrics,
} from "./conversation-context.mjs";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
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

  const active = loadActiveRun(conversationId);
  if (!active?.run_id) allow();

  const manifest = loadRunManifest(active.run_id);
  if (
    !manifest ||
    manifest.status === "completed" ||
    manifest.status === "cancelled"
  ) {
    allow();
  }
  if (manifest.conversation_id && manifest.conversation_id !== conversationId) allow();

  const subagentId = hook.subagent_id ?? hook.subagentId ?? null;
  if (!subagentId) {
    allow();
    return;
  }

  const arrayIndex =
    findAgentArrayIndexBySubagentId(manifest, manifest.phase, subagentId) ??
    findAgentIndexToComplete(manifest, manifest.phase);
  const phaseSlot =
    arrayIndex != null && arrayIndex >= 0
      ? (manifest.swarm?.agents?.[arrayIndex]?.index ?? arrayIndex + 1)
      : 1;

  const summary = formatHookProgressSummary(hook);
  if (!summary) {
    writeJson(path.join(runDir(active.run_id), "run.json"), manifest);
    allow();
    return;
  }

  const detail = `${summary} agent_index=${phaseSlot}`;

  recordLog(manifest, {
    event: "agent_progress",
    phase: manifest.phase,
    phase_kind: manifest.phase_kind,
    detail,
    level: "debug",
  });

  const contextMetrics = resolveConversationContextMetrics(hook);
  if (contextMetrics) {
    applyConversationContextMetrics(manifest, contextMetrics, "postToolUse");
  }

  writeJson(path.join(runDir(active.run_id), "run.json"), manifest);
  allow();
});
