#!/usr/bin/env node
/**
 * preToolUse — graph-native finding + progressive-read budgets.
 * Soft-allows only when no run can be resolved (logged as soft_allow_no_run).
 */
import fs from "fs";
import path from "path";
import { loadRunManifest, runDir } from "./lib.mjs";
import { resolveRunId } from "./resolve-run-id.mjs";
import { loadRetrievalConfig } from "./experience/paths.mjs";
import { resolveWorkspaceRoot } from "./experience/repo-graph.mjs";
import {
  budgetsFromPhaseContext,
  evaluateToolAccess,
  READ_TOOL,
  FINDING_TOOLS,
  toolPathScope,
} from "./evaluate-finding-tools.mjs";
import {
  healPathIntoPhaseContext,
  recordRetrievalMiss,
} from "./retrieval-miss.mjs";
import { pathExistsUnderRoot } from "./sought-paths.mjs";

function loadPhaseContext(runId) {
  const pcPath = path.join(runDir(runId), "artifacts", "phase_context.json");
  if (!fs.existsSync(pcPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pcPath, "utf8"));
  } catch {
    return null;
  }
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

function emitSoftAllow(toolName, hook) {
  const event = {
    event: "soft_allow_no_run",
    tool: toolName,
    session_id: hook?.session_id ?? hook?.sessionId ?? null,
  };
  try {
    console.error(JSON.stringify(event));
  } catch {
    // ignore
  }
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

  if (process.env.AAAC_ORCHESTRATOR_CHAT === "1") {
    allow();
  }

  let hook;
  try {
    hook = JSON.parse(input || "{}");
  } catch {
    allow();
  }

  const toolName = hook.tool_name ?? hook.toolName ?? "";
  if (!READ_TOOL.test(toolName) && !FINDING_TOOLS.test(toolName)) allow();

  const resolved = resolveRunId(hook);
  const runId = resolved.runId;
  if (!runId) {
    emitSoftAllow(toolName, hook);
    allow();
  }

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
    const scope = toolPathScope(toolInput);
    try {
      if (decision.miss) {
        recordRetrievalMiss(
          runId,
          {
            ...decision.miss,
            phase: manifest.phase ?? null,
            agent_id: agentIndex,
          },
          { dedupe: true },
        );
      }
    } catch {
      // miss store optional
    }

    if (READ_TOOL.test(toolName) && decision.reason === "read_not_in_packet" && scope) {
      let root = process.cwd();
      try {
        root = resolveWorkspaceRoot();
      } catch {
        root = process.env.AAAC_WORKSPACE_ROOT || process.cwd();
      }
      if (pathExistsUnderRoot(scope, root)) {
        try {
          healPathIntoPhaseContext(runId, scope);
        } catch {
          // ignore
        }
        deny(
          decision.user_message ?? "Read denied",
          `${decision.message} Path ${scope} is now in the packet — retry Read of that path only.`,
        );
      }
    }

    deny(
      decision.user_message ?? "Tool denied",
      decision.message ?? "Graph-native finding / read budget gate",
    );
  }
  allow();
});
