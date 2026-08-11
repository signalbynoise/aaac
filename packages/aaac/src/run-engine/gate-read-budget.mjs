#!/usr/bin/env node
/**
 * preToolUse — enforce progressive-read budgets from repo_memory / retrieval.yaml.
 * Soft-allows when no active run or budgets missing.
 */
import fs from "fs";
import path from "path";
import {
  loadActiveRun,
  loadRunManifest,
  conversationIdFromHook,
  runDir,
} from "./lib.mjs";
import { loadRetrievalConfig } from "./experience/paths.mjs";

const READ_TOOLS = /^(Read|Grep|Glob|SemanticSearch)$/i;
const SEARCH_TOOLS = /^(Grep|Glob|SemanticSearch)$/i;

function loadBudgets(runId) {
  const defaults = loadRetrievalConfig()?.repo_memory ?? {};
  const budgets = {
    max_agent_files_read: defaults.max_agent_files_read ?? 16,
    max_full_file_opens: defaults.max_full_file_opens ?? 4,
    max_gap_search_globs: defaults.max_gap_search_globs ?? 8,
  };
  try {
    const pcPath = path.join(runDir(runId), "artifacts", "phase_context.json");
    if (fs.existsSync(pcPath)) {
      const pc = JSON.parse(fs.readFileSync(pcPath, "utf8"));
      const rb = pc?.experience?.repo_memory?.meta?.read_budgets;
      if (rb && typeof rb === "object") {
        for (const key of Object.keys(budgets)) {
          if (Number.isFinite(Number(rb[key]))) budgets[key] = Number(rb[key]);
        }
      }
    }
  } catch {
    // keep defaults
  }
  return budgets;
}

function currentAgentCounters(manifest) {
  const agents = manifest?.swarm?.agents ?? [];
  const phase = manifest?.phase;
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

function isFullFileRead(toolName, toolInput) {
  if (!/^Read$/i.test(toolName)) return false;
  const input = toolInput ?? {};
  const hasOffset =
    input.offset != null || input.start_line != null || input.startLine != null;
  const hasLimit =
    input.limit != null || input.end_line != null || input.endLine != null;
  return !hasOffset && !hasLimit;
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
  if (!READ_TOOLS.test(toolName)) allow();

  const conversationId = conversationIdFromHook(hook);
  if (!conversationId) allow();

  const active = loadActiveRun(conversationId);
  if (
    !active?.run_id ||
    active.status === "completed" ||
    active.status === "cancelled"
  ) {
    allow();
  }

  const manifest = loadRunManifest(active.run_id);
  if (
    !manifest ||
    manifest.status === "completed" ||
    manifest.status === "cancelled"
  ) {
    allow();
  }

  const budgets = loadBudgets(active.run_id);
  const counters = currentAgentCounters(manifest);
  const toolInput =
    hook.tool_input ?? hook.toolInput ?? hook.arguments ?? {};

  if (SEARCH_TOOLS.test(toolName)) {
    if (counters.gap_searches >= budgets.max_gap_search_globs) {
      deny(
        "Read budget: gap search limit reached",
        `max_gap_search_globs=${budgets.max_gap_search_globs} already used. Use repo_memory.read_pack / focus_spans.envelope_text; stop Grep/Glob tourism.`,
      );
    }
    allow();
  }

  // Read
  if (counters.files_read >= budgets.max_agent_files_read) {
    deny(
      "Read budget: file read limit reached",
      `max_agent_files_read=${budgets.max_agent_files_read}. Prefer inlined envelope_text / read_pack; widen only for true gaps.`,
    );
  }
  if (
    isFullFileRead(toolName, toolInput) &&
    counters.full_file_opens >= budgets.max_full_file_opens
  ) {
    deny(
      "Read budget: full-file open limit reached",
      `max_full_file_opens=${budgets.max_full_file_opens}. Read with offset/limit (envelope → symbol) instead of full files.`,
    );
  }
  allow();
});
