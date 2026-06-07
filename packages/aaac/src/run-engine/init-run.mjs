#!/usr/bin/env node
/** Create AAAC Run — stdin: Cursor beforeSubmitPrompt hook JSON (conversation-scoped). */
import fs from "fs";
import {
  loadRegistry,
  parseAaacPrompt,
  resolvePending,
  runDir,
  slugify,
  isoNow,
  phaseKind,
  writeJson,
  saveActiveRun,
  loadActiveRun,
  loadRunManifest,
  clearActiveRun,
  cancelRunManifest,
  isUserStopIntent,
  conversationIdFromHook,
  promptFromHook,
} from "./lib.mjs";
import { recordLog, recordDecision } from "./log.mjs";
import {
  resolveCapabilitiesWithRuntime,
  evaluateCapabilityRuntimePolicy,
  loadObjectMaturity,
} from "./capability-evidence.mjs";

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    if (process.stdin.isTTY) resolve("");
  });
}

const stdin = await readStdin();
let hook = {};
try {
  hook = stdin ? JSON.parse(stdin) : {};
} catch {
  hook = {};
}

const prompt = process.argv[2] ?? promptFromHook(hook);
const conversationId = conversationIdFromHook(hook);

if (isUserStopIntent(prompt) && conversationId) {
  const active = loadActiveRun(conversationId);
  let cancelledRunId = null;
  if (active?.run_id) {
    const existing = loadRunManifest(active.run_id);
    if (
      existing &&
      existing.status !== "completed" &&
      existing.status !== "cancelled"
    ) {
      cancelRunManifest(existing, prompt.trim());
      recordLog(existing, {
        event: "run_cancelled",
        phase: existing.phase,
        phase_kind: existing.phase_kind,
        detail: `user stop: ${prompt.trim()}`,
        level: "info",
      });
      recordDecision(existing, {
        phase: existing.phase ?? "dispatch",
        decision: "user_stop",
        reason: "User requested stop",
        evidence: prompt.trim(),
      });
      writeJson(`${runDir(active.run_id)}/run.json`, existing);
      cancelledRunId = active.run_id;
    }
    clearActiveRun(conversationId);
  }
  console.log(
    JSON.stringify({ ok: true, aaac: false, cancelled: cancelledRunId }),
  );
  process.exit(0);
}

const parsed = parseAaacPrompt(prompt);

if (!parsed) {
  console.log(JSON.stringify({ ok: true, aaac: false }));
  process.exit(0);
}

if (!conversationId) {
  console.log(
    JSON.stringify({
      ok: false,
      aaac: true,
      error: "missing conversation_id — cannot scope Run to this chat",
    }),
  );
  process.exit(0);
}

const registry = loadRegistry();
const pending = resolvePending(parsed.command, registry);
const now = isoNow();
const date = now.slice(0, 10).replace(/-/g, "");
const convShort = conversationId.slice(0, 8);
const runId = `run_${date}_${slugify(parsed.command + (parsed.domain ? `-${parsed.domain}` : ""))}-${convShort}`;

const entry = registry.commands[parsed.command];
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
  conversation_id: conversationId,
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
  swarm: { task_launches_this_phase: 0, phase: pending[0] },
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
  event: "graph_resolved",
  phase: "dispatch",
  phase_kind: "work",
  detail: `orchestrator=${entry.orchestrator ?? "null"} pending=${pending.length} phases`,
  level: "debug",
});

recordLog(manifest, {
  event: "run_created",
  phase: pending[0],
  phase_kind: phaseKind(pending[0], registry),
  detail: `Run for /${parsed.command} chat=${convShort}`,
  level: "info",
});

recordDecision(manifest, {
  phase: "dispatch",
  decision: "run_created",
  reason: "Hook-initiated Run (conversation-scoped)",
  evidence: parsed.raw,
});

for (const [capabilityId, resolution] of Object.entries(manifest.capabilities_resolved)) {
  recordLog(manifest, {
    event: "capability_resolved",
    phase: "dispatch",
    phase_kind: "work",
    detail: `${capabilityId}:${(resolution.providers ?? []).map((p) => p.id).join(",")} state=${resolution.runtime?.state ?? "experimental"}`,
    level: "debug",
  });
}

recordLog(manifest, {
  event: "capability_runtime_evaluated",
  phase: "dispatch",
  phase_kind: "work",
  detail: `action=${capabilityRuntimePolicy.action} maturity=${objectMaturity}`,
  level: "info",
});

if (capabilityRuntimePolicy.action === "warn") {
  recordLog(manifest, {
    event: "capability_runtime_warn",
    phase: "dispatch",
    phase_kind: "work",
    detail: capabilityRuntimePolicy.reasons.join("; "),
    level: "warn",
  });
}

recordDecision(manifest, {
  phase: "dispatch",
  decision: "capability_runtime",
  reason: capabilityRuntimePolicy.action,
  evidence: capabilityRuntimePolicy.reasons.join("; ") || "allow",
});

recordLog(manifest, {
  event: "phase_start",
  phase: pending[0],
  phase_kind: phaseKind(pending[0], registry),
  detail: `Run for /${parsed.command} chat=${convShort}`,
  level: "info",
});

manifest.updated_at = now;
writeJson(`${runDir(runId)}/run.json`, manifest);
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

console.log(
  JSON.stringify({
    ok: true,
    aaac: true,
    run_id: runId,
    conversation_id: conversationId,
    command: parsed.command,
    phase: pending[0],
    message: `AAAC Run ${runId} created for this chat only.`,
  }),
);
