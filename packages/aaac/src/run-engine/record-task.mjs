#!/usr/bin/env node
import path from "path";
import {
  AAAC_ROOT,
  loadActiveRun,
  loadEnforcement,
  runDir,
  saveActiveRun,
  isoNow,
  conversationIdFromHook,
} from "./lib.mjs";
import { recordLog } from "./log.mjs";
import { resolveModelForPhase } from "./resolve-model-for-phase.mjs";
import {
  resolveAgentSpecById,
} from "./swarm-agent-specs.mjs";
import {
  resolveConversationContextMetrics,
  applyConversationContextMetrics,
} from "./conversation-context.mjs";
import { mutateAgentManifest } from "./swarm-telemetry.mjs";

function inferAgentSpecId(hook, description) {
  const explicit = hook.agent_spec_id ?? hook.agentSpecId;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const match = String(description ?? "").match(/(?:^|\/)agents\/([\w-]+)\.md/i);
  return match?.[1] ?? null;
}

function assertExplicitSlot(phase, launchIndex, explicitId, slot) {
  const explicitSpec = resolveAgentSpecById({ aaacRoot: AAAC_ROOT, id: explicitId });
  if (!explicitSpec) {
    throw new Error(`Unknown explicit agent spec ${explicitId} for ${phase} slot ${launchIndex}`);
  }
  const slotBaseId = slot?.id?.replace(/-wave-\d+$/, "");
  if (
    slot &&
    explicitSpec.id === slotBaseId &&
    explicitSpec.path === slot.path
  ) {
    return slot;
  }
  throw new Error(
    `Explicit agent spec ${explicitId} does not match ${phase} slot ${launchIndex}` +
    `${slot?.id ? ` (${slot.id})` : ""}`,
  );
}

function resolveExpectedSpec(manifest, launchIndex, explicitId) {
  const phase = manifest.phase;
  const expected = manifest.swarm?.expected_specs_phase === phase
    ? manifest.swarm.expected_agent_specs ?? []
    : [];
  const slot = expected?.[launchIndex - 1] ?? null;
  if (!slot) throw new Error(`No expected agent spec for ${phase} slot ${launchIndex}`);
  if (!explicitId) return slot;
  return assertExplicitSlot(phase, launchIndex, explicitId, slot);
}

function resolveLaunchDescription(hook) {
  return hook.description ??
    hook.subagent_description ??
    hook.prompt ??
    hook.tool_input?.description ??
    hook.toolInput?.description ??
    null;
}

function resolveLaunchSpec(manifest, hook, launchIndex, enforcement) {
  const description = resolveLaunchDescription(hook);
  let inferredId = inferAgentSpecId(hook, description);
  const requiredSpec = enforcement.agent_separation?.required_execute_agent_spec ?? null;
  if (manifest.phase === "execute" && !inferredId) inferredId = requiredSpec;
  const agentSpec = resolveExpectedSpec(
    manifest,
    launchIndex,
    inferredId,
  );
  const explicitPath = hook.agent_spec_path ?? hook.agentSpecPath;
  if (
    typeof explicitPath === "string" &&
    explicitPath.trim() &&
    explicitPath.trim() !== agentSpec.path
  ) {
    throw new Error(
      `Explicit agent spec path ${explicitPath.trim()} does not match ${agentSpec.path}`,
    );
  }
  const initialSummary = agentSpec.initial_summary ?? null;
  if (agentSpec.id && !initialSummary) {
    throw new Error(`Agent spec ${agentSpec.id} has no valid Role summary`);
  }
  return { agentSpec, description, initialSummary, requiredSpec };
}

function createAgentEntry(manifest, hook, launchIndex, launch) {
  const { agentSpec, description, initialSummary } = launch;
  const subagentType = hook.subagent_type ?? hook.subagentType ?? null;
  const routing = resolveModelForPhase({
    phase: manifest.phase,
    agent_spec_id: agentSpec.id,
    subagent_type: subagentType,
    verb: manifest.verb ?? null,
    command: manifest.command ?? null,
  });
  const observedModel = hook.model ?? null;
  const subagentId = hook.subagent_id ?? hook.subagentId ?? null;
  const startedAt = isoNow();
  return {
    at: startedAt,
    started_at: startedAt,
    index: launchIndex,
    phase: manifest.phase,
    subagent_type: subagentType,
    description,
    ...(agentSpec.id ? { agent_spec_id: agentSpec.id } : {}),
    ...(agentSpec.path ? { agent_spec_path: agentSpec.path } : {}),
    ...(subagentId ? { subagent_id: subagentId } : {}),
    ...(initialSummary ? { initial_summary: initialSummary, last_progress: initialSummary } : {}),
    model: observedModel,
    expected_model: routing.model_slug ?? null,
    expected_tier: routing.tier ?? null,
    model_routing_source: routing.source ?? null,
    model_mismatch: observedModel != null && observedModel !== routing.model_slug,
    readonly: hook.readonly ?? null,
  };
}

function registerActiveCodeEditor(manifest, entry, launch, enforcement) {
  const delegatePhases =
    enforcement.agent_separation?.editor_delegate_phases ?? ["execute", "debt_sweep"];
  if (
    !entry.subagent_id ||
    !delegatePhases.includes(manifest.phase) ||
    (launch.requiredSpec && launch.agentSpec.id !== launch.requiredSpec)
  ) return;
  manifest.swarm.active_code_editors = manifest.swarm.active_code_editors ?? [];
  manifest.swarm.active_code_editors.push({
    subagent_id: entry.subagent_id,
    agent_spec_id: launch.agentSpec.id,
    started_at: entry.started_at,
    phase: manifest.phase,
  });
}

function recordAgentSpawn(manifest, entry, launch) {
  recordLog(manifest, {
    event: "agent_spawned",
    phase: manifest.phase,
    phase_kind: manifest.phase_kind,
    detail: JSON.stringify({
      index: entry.index,
      phase: manifest.phase,
      started_at: entry.started_at,
      ...(launch.agentSpec.id ? { agent_spec_id: launch.agentSpec.id } : {}),
      ...(launch.initialSummary ? { initial_summary: launch.initialSummary } : {}),
      ...(entry.model ? { model: entry.model } : {}),
    }),
    level: "debug",
  });
}

function applyAgentLaunch(manifest, hook, conversationId, enforcement) {
  if (
    ["completed", "cancelled"].includes(manifest.status) ||
    (manifest.conversation_id && manifest.conversation_id !== conversationId)
  ) return { skipped: true };
  manifest.swarm = manifest.swarm ?? {};
  manifest.swarm.agents = manifest.swarm.agents ?? [];
  const launchIndex = (manifest.swarm.task_launches_this_phase ?? 0) + 1;
  manifest.swarm.task_launches_this_phase = launchIndex;
  manifest.swarm.phase = manifest.phase;
  const launch = resolveLaunchSpec(manifest, hook, launchIndex, enforcement);
  const entry = createAgentEntry(manifest, hook, launchIndex, launch);
  manifest.swarm.agents.push(entry);
  registerActiveCodeEditor(manifest, entry, launch, enforcement);
  recordAgentSpawn(manifest, entry, launch);
  const contextMetrics = resolveConversationContextMetrics(hook);
  if (contextMetrics) applyConversationContextMetrics(manifest, contextMetrics, "subagentStart");
  return { launchIndex };
}

function allow() {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

function parseHookInput() {
  try {
    return JSON.parse(input || "{}");
  } catch {
    return null;
  }
}

function reportHookFailure(error, context = {}) {
  console.error(JSON.stringify({
    level: "error",
    module: "aaac-hook",
    operation: "record-task",
    message: "Failed to record subagent launch; allowing hook",
    ...context,
    error: error instanceof Error ? error.message : String(error),
  }));
}

function handleInputEnd() {
  const hook = parseHookInput();
  if (!hook) allow();
  const conversationId = conversationIdFromHook(hook);
  if (!conversationId) allow();
  let active;
  try {
    active = loadActiveRun(conversationId);
    if (!active?.run_id) allow();
    const manifestPath = path.join(runDir(active.run_id), "run.json");
    const enforcement = loadEnforcement();
    const result = mutateAgentManifest(
      manifestPath,
      (manifest) => applyAgentLaunch(manifest, hook, conversationId, enforcement),
    );
    if (!result.result?.skipped) {
      saveActiveRun(conversationId, {
        ...active,
        task_launches_this_phase: result.manifest.swarm.task_launches_this_phase,
      });
    }
  } catch (error) {
    reportHookFailure(error, {
      conversation_id: conversationId,
      run_id: active?.run_id ?? null,
    });
  }
  allow();
}

let input = ""; process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", handleInputEnd);
