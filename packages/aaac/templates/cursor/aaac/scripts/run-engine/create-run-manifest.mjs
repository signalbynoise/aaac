/**
 * Shared Run manifest creation for hook and Agentic OS dispatch paths.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  loadRegistry,
  resolvePending,
  runDir,
  slugify,
  isoNow,
  phaseKind,
  writeJson,
  saveActiveRun,
  saveSessionRun,
} from "./lib.mjs";
import { recordLog, recordDecision } from "./log.mjs";
import { supersedeIncompleteRuns } from "./reconcile-run-status.mjs";
import {
  resolveCapabilitiesWithRuntime,
  evaluateCapabilityRuntimePolicy,
  loadObjectMaturity,
} from "./capability-evidence.mjs";

export function createRunManifest({
  parsed,
  origin = "cursor-chat",
  sessionId = null,
  conversationId = null,
  adapter = null,
}) {
  const registry = loadRegistry();
  const pending = resolvePending(parsed.command, registry);
  const now = isoNow();
  const date = now.slice(0, 10).replace(/-/g, "");
  const suffix =
    origin === "agentic-os"
      ? (sessionId ?? randomUUID()).slice(0, 8)
      : (conversationId ?? "chat").slice(0, 8);
  const runId = `run_${date}_${slugify(parsed.command + (parsed.domain ? `-${parsed.domain}` : ""))}-${suffix}`;

  const entry = registry.commands[parsed.command];
  supersedeIncompleteRuns({
    conversationId,
    sessionId,
    newRunId: runId,
  });

  fs.mkdirSync(runDir(runId), { recursive: true });

  const runObject = entry.object ?? null;
  const runVerb = entry.verb ?? parsed.command.split("-")[0];
  const objectMaturity = loadObjectMaturity(runObject);
  const capabilitiesResolved = resolveCapabilitiesWithRuntime(runObject, runVerb);
  const capabilityRuntimePolicy = evaluateCapabilityRuntimePolicy(capabilitiesResolved, {
    object_maturity: objectMaturity,
  });

  const manifest = {
    run_id: runId,
    origin,
    session_id: sessionId,
    conversation_id: conversationId,
    execution: {
      adapter: adapter ?? (origin === "agentic-os" ? "cursor-local" : null),
      cursor_run_id: null,
    },
    command: parsed.command,
    verb: entry.verb ?? parsed.command.split("-")[0],
    object: entry.object ?? null,
    domain: parsed.domain,
    intent: parsed.intent,
    orchestrator: entry.orchestrator ?? null,
    status: "running",
    phase: pending[0],
    phase_kind: phaseKind(pending[0], registry),
    awaiting_approval: false,
    blocked_reason: null,
    completed: [],
    pending: pending.slice(1),
    decisions: [],
    artifacts: {},
    checkpoints: [],
    log: [],
    capabilities_resolved: capabilitiesResolved,
    capability_runtime: capabilityRuntimePolicy,
    capability_runtime_approved: false,
    confidence: { architecture: null, requirements: null, scope: null },
    gates: { stack: entry.gate_stack ?? null, results: {} },
    swarm: { task_launches_this_phase: 0, phase: pending[0], agents: [] },
    enforcement: { edit_allowed: false, hook_version: 2 },
    created_at: now,
    updated_at: now,
  };

  recordLog(manifest, {
    event: "command_parsed",
    phase: "dispatch",
    phase_kind: "work",
    detail: parsed.raw,
    level: "info",
  });

  recordDecision(manifest, {
    phase: "dispatch",
    decision: "command_parsed",
    reason: `Parsed /${parsed.command}`,
    evidence: parsed.raw,
  });

  recordLog(manifest, {
    event: "run_created",
    phase: pending[0],
    phase_kind: phaseKind(pending[0], registry),
    detail: `Run for /${parsed.command} origin=${origin}`,
    level: "info",
  });

  recordDecision(manifest, {
    phase: "dispatch",
    decision: "run_created",
    reason: origin === "agentic-os" ? "Agentic OS dispatch" : "Hook-initiated Run",
    evidence: parsed.raw,
  });

  recordLog(manifest, {
    event: "phase_start",
    phase: pending[0],
    phase_kind: phaseKind(pending[0], registry),
    detail: `Run for /${parsed.command}`,
    level: "info",
  });

  manifest.updated_at = now;
  writeJson(`${runDir(runId)}/run.json`, manifest);

  if (conversationId) {
    saveActiveRun(conversationId, {
      run_id: runId,
      conversation_id: conversationId,
      command: parsed.command,
      phase: pending[0],
      status: "running",
      task_launches_this_phase: 0,
      edit_allowed: false,
      started_at: now,
    });
  }

  if (sessionId) {
    saveSessionRun(sessionId, {
      run_id: runId,
      session_id: sessionId,
      command: parsed.command,
      phase: pending[0],
      status: "running",
      origin,
      started_at: now,
    });
    import("./persist-run.mjs")
      .then(({ scheduleSessionPersist }) => scheduleSessionPersist(sessionId))
      .catch(() => {});
  }

  return { manifest, runId, pending };
}
