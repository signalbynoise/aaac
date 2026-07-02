#!/usr/bin/env node
/**
 * Dispatch AAAC Run from Agentic OS (no Cursor conversation_id required).
 * Usage: node dispatch-run.mjs "<prompt>" [--session-id aos_xxx] [--json]
 */
import { randomUUID } from "crypto";
import { parseAaacPrompt } from "./lib.mjs";
import { createRunManifest } from "./create-run-manifest.mjs";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const filtered = args.filter((a) => a !== "--json");
const sessionIdx = filtered.indexOf("--session-id");
let sessionId = null;
if (sessionIdx >= 0) {
  sessionId = filtered[sessionIdx + 1] ?? null;
  filtered.splice(sessionIdx, 2);
}

const prompt = filtered.join(" ").trim();
const parsed = parseAaacPrompt(prompt);

if (!parsed) {
  const out = { ok: false, error: "Invalid AAAC command prompt" };
  console.log(JSON.stringify(out));
  process.exit(1);
}

const resolvedSessionId = sessionId ?? `aos_${randomUUID()}`;
const { manifest, runId } = createRunManifest({
  parsed,
  origin: "agentic-os",
  sessionId: resolvedSessionId,
  adapter: "cursor-local",
});

const result = {
  ok: true,
  aaac: true,
  run_id: runId,
  session_id: resolvedSessionId,
  command: manifest.command,
  phase: manifest.phase,
  origin: "agentic-os",
};

if (jsonOut) {
  console.log(JSON.stringify(result));
} else {
  console.log(JSON.stringify(result, null, 2));
}
