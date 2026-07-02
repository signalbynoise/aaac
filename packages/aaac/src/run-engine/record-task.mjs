#!/usr/bin/env node
import path from "path";
import {
  loadActiveRun,
  loadRunManifest,
  loadEnforcement,
  runDir,
  writeJson,
  saveActiveRun,
  isoNow,
  conversationIdFromHook,
} from "./lib.mjs";
import { recordLog } from "./log.mjs";

function inferAgentSpecId(hook, description) {
  const explicit = hook.agent_spec_id ?? hook.agentSpecId ?? null;
  if (explicit && typeof explicit === "string") return explicit.trim() || null;

  const desc = typeof description === "string" ? description.trim() : "";
  if (!desc) return null;

  const pathMatch = desc.match(/(?:^|\/)agents\/([\w-]+)\.md/i);
  if (pathMatch) return pathMatch[1];

  const slug = desc.split(/\s+/)[0]?.replace(/^#?\d+$/, "") ?? "";
  if (/^[\w-]+$/.test(slug) && slug.includes("-")) return slug;

  return null;
}

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

  const enforcement = loadEnforcement();
  const delegatePhases =
    enforcement.agent_separation?.editor_delegate_phases ?? ["execute", "debt_sweep"];
  const requiredExecuteSpec =
    enforcement.agent_separation?.required_execute_agent_spec ?? null;

  const description =
    hook.description ??
    hook.subagent_description ??
    hook.prompt ??
    hook.tool_input?.description ??
    hook.toolInput?.description ??
    null;
  let agentSpecId = inferAgentSpecId(hook, description);
  if (manifest.phase === "execute" && !agentSpecId && requiredExecuteSpec) {
    agentSpecId = requiredExecuteSpec;
  }
  const subagentId = hook.subagent_id ?? hook.subagentId ?? null;

  const agentEntry = {
    at: isoNow(),
    started_at: isoNow(),
    index: launchIndex,
    phase: manifest.phase,
    subagent_type: hook.subagent_type ?? hook.subagentType ?? null,
    description,
    ...(agentSpecId ? { agent_spec_id: agentSpecId } : {}),
    ...(subagentId ? { subagent_id: subagentId } : {}),
    model: hook.model ?? null,
    readonly: hook.readonly ?? null,
  };
  manifest.swarm.agents = manifest.swarm.agents ?? [];
  manifest.swarm.agents.push(agentEntry);
  const isDelegatePhase = delegatePhases.includes(manifest.phase);
  const matchesRequiredSpec =
    !requiredExecuteSpec || agentSpecId === requiredExecuteSpec;
  if (subagentId && isDelegatePhase && matchesRequiredSpec) {
    manifest.swarm.active_code_editors = manifest.swarm.active_code_editors ?? [];
    manifest.swarm.active_code_editors.push({
      subagent_id: subagentId,
      agent_spec_id: agentSpecId,
      started_at: isoNow(),
      phase: manifest.phase,
    });
  }

  const spawnPayload = {
    index: launchIndex,
    phase: manifest.phase,
    started_at: agentEntry.started_at,
    ...(agentEntry.subagent_type ? { subagent_type: agentEntry.subagent_type } : {}),
    ...(agentEntry.description ? { description: agentEntry.description } : {}),
    ...(agentEntry.agent_spec_id ? { agent_spec_id: agentEntry.agent_spec_id } : {}),
    ...(agentEntry.model ? { model: agentEntry.model } : {}),
  };

  recordLog(manifest, {
    event: "agent_spawned",
    phase: manifest.phase,
    phase_kind: manifest.phase_kind,
    detail: JSON.stringify(spawnPayload),
    level: "debug",
  });

  writeJson(path.join(runDir(active.run_id), "run.json"), manifest);
  saveActiveRun(conversationId, {
    ...active,
    task_launches_this_phase: manifest.swarm.task_launches_this_phase,
  });
  allow();
});
