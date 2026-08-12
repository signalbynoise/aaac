#!/usr/bin/env node
/**
 * preToolUse — graph-native finding + progressive-read budgets.
 * Soft-allows when no active run.
 */
import fs from "fs";
import path from "path";
import {
  loadActiveRun,
  loadRunManifest,
  conversationIdFromHook,
  runDir,
  readJson,
} from "./lib.mjs";
import { loadRetrievalConfig } from "./experience/paths.mjs";
import {
  budgetsFromPhaseContext,
  evaluateToolAccess,
  READ_TOOL,
  FINDING_TOOLS,
} from "./evaluate-finding-tools.mjs";

function loadPhaseContext(runId) {
  const pcPath = path.join(runDir(runId), "artifacts", "phase_context.json");
  if (!fs.existsSync(pcPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pcPath, "utf8"));
  } catch {
    return null;
  }
}

function resolveRunId(hook) {
  const envRun = process.env.AAAC_RUN_ID?.trim();
  if (envRun) return envRun;

  const conversationId = conversationIdFromHook(hook);
  if (conversationId) {
    const active = loadActiveRun(conversationId);
    if (active?.run_id) return active.run_id;
  }

  // Agentic OS sessions: active-runs may be keyed by aos session id
  const sessionId =
    process.env.AAAC_SESSION_ID?.trim() ||
    hook?.session_id ||
    hook?.sessionId ||
    null;
  if (sessionId) {
    const active = loadActiveRun(sessionId);
    if (active?.run_id) return active.run_id;
    // sessions/{id}.json may point at run
    try {
      const sessionsRoot = path.join(
        process.cwd(),
        ".cursor/aaac/state/sessions",
      );
      const sess = readJson(path.join(sessionsRoot, `${sessionId}.json`), null);
      if (sess?.run_id) return sess.run_id;
    } catch {
      // ignore
    }
  }

  return null;
}

function currentAgentCounters(manifest, agentIndex = null) {
  const agents = manifest?.swarm?.agents ?? [];
  const phase = manifest?.phase;
  if (agentIndex != null && Number.isFinite(Number(agentIndex))) {
    const byIndex = agents.find(
      (a) => a.phase === phase && Number(a.index) === Number(agentIndex),
    );
    if (byIndex) {
      return {
        files_read: Number(byIndex.files_read) || 0,
        full_file_opens: Number(byIndex.full_file_opens) || 0,
        gap_searches: Number(byIndex.gap_searches) || 0,
      };
    }
  }
  const open = [...agents]
    .reverse()
    .find((a) => a.phase === phase && !a.completed_at);
  const agent = open ?? agents[agents.length - 1];
  if (!agent) {
    return { files_read: 0, full_file_opens: 0, gap_searches: 0 };
  }
  return {
    files_read: Number(agent.files_read) || 0,
    full_file_opens: Number(agent.full_file_opens) || 0,
    gap_searches: Number(agent.gap_searches) || 0,
  };
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const deny = (userMessage, agentMessage) => {
    console.log(
      JSON.stringify({
        permission: "deny",
        user_message: userMessage,
        agent_message: agentMessage,
      }),
    );
    process.exit(0);
  };
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

  const toolName = hook.tool_name ?? hook.toolName ?? "";
  if (!READ_TOOL.test(toolName) && !FINDING_TOOLS.test(toolName)) allow();

  const runId = resolveRunId(hook);
  if (!runId) allow();

  const manifest = loadRunManifest(runId);
  if (
    !manifest ||
    manifest.status === "completed" ||
    manifest.status === "cancelled"
  ) {
    allow();
  }

  const phaseContext = loadPhaseContext(runId);
  const retrievalDefaults = loadRetrievalConfig()?.repo_memory ?? {};
  const budgets = budgetsFromPhaseContext(phaseContext, retrievalDefaults);
  const agentIndex =
    hook.agent_index ?? hook.agentIndex ?? process.env.AAAC_AGENT_INDEX ?? null;
  const counters = currentAgentCounters(manifest, agentIndex);
  const toolInput =
    hook.tool_input ?? hook.toolInput ?? hook.arguments ?? {};

  const decision = evaluateToolAccess({
    toolName,
    toolInput,
    phaseContext,
    budgets,
    counters,
  });

  if (!decision.allow) {
    deny(
      decision.user_message ?? "Tool denied",
      decision.message ?? "Graph-native finding / read budget gate",
    );
  }
  allow();
});
