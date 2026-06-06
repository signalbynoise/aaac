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
  conversationIdFromHook,
  promptFromHook,
} from "./lib.mjs";
import { recordLog, recordDecision } from "./log.mjs";

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
  capabilities_resolved: {},
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
