#!/usr/bin/env node
import path from "path";
import {
  loadActiveRun,
  loadRunManifest,
  runDir,
  writeJson,
  saveActiveRun,
  conversationIdFromHook,
} from "./lib.mjs";
import { applyAgentComplete, estimateUsageFromText } from "./swarm-telemetry.mjs";

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

  const outputText =
    hook.result ?? hook.output ?? hook.response ?? hook.summary ?? "";
  const estimated = outputText
    ? estimateUsageFromText("", outputText)
    : { tokens: null, context: null };

  const rawIndex =
    hook.agent_index ?? hook.agentIndex ?? hook.launch_index ?? hook.launchIndex;
  const agentIndex = rawIndex != null ? Number(rawIndex) - 1 : undefined;

  const subagentId = hook.subagent_id ?? hook.subagentId ?? null;
  if (subagentId && Array.isArray(manifest.swarm?.active_code_editors)) {
    manifest.swarm.active_code_editors = manifest.swarm.active_code_editors.filter(
      (e) => e.subagent_id !== subagentId,
    );
  }

  applyAgentComplete(manifest, {
    agentIndex: Number.isFinite(agentIndex) ? agentIndex : undefined,
    phase: manifest.phase,
    detail: "",
    cursorRunId: hook.cursor_run_id ?? hook.cursorRunId ?? null,
    tokens: hook.tokens ?? estimated.tokens,
    context: hook.context ?? hook.context_score ?? estimated.context,
  });

  writeJson(path.join(runDir(active.run_id), "run.json"), manifest);
  saveActiveRun(conversationId, active);
  allow();
});
