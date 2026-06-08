#!/usr/bin/env node
import path from "path";
import {
  loadActiveRun,
  loadRunManifest,
  runDir,
  writeJson,
  saveActiveRun,
  isoNow,
  conversationIdFromHook,
} from "./lib.mjs";
import { recordLog } from "./log.mjs";

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

  manifest.swarm = manifest.swarm ?? {};
  const launchIndex = (manifest.swarm.task_launches_this_phase ?? 0) + 1;
  manifest.swarm.task_launches_this_phase = launchIndex;
  manifest.swarm.phase = manifest.phase;

  const agentEntry = {
    at: isoNow(),
    index: launchIndex,
    phase: manifest.phase,
    subagent_type: hook.subagent_type ?? hook.subagentType ?? null,
    description: hook.description ?? hook.subagent_description ?? null,
    model: hook.model ?? null,
    readonly: hook.readonly ?? null,
  };
  manifest.swarm.agents = manifest.swarm.agents ?? [];
  manifest.swarm.agents.push(agentEntry);

  const telemetryDetail = JSON.stringify({
    count: launchIndex,
    subagent_type: agentEntry.subagent_type,
    index: launchIndex,
  });

  recordLog(manifest, {
    event: "agent_spawned",
    phase: manifest.phase,
    phase_kind: manifest.phase_kind,
    detail: telemetryDetail,
    level: "debug",
  });

  writeJson(path.join(runDir(active.run_id), "run.json"), manifest);
  saveActiveRun(conversationId, {
    ...active,
    task_launches_this_phase: manifest.swarm.task_launches_this_phase,
  });
  allow();
});
