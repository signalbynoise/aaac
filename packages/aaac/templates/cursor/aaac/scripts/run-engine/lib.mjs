#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CURSOR_ROOT = path.resolve(__dirname, "../../..");
export const AAAC_ROOT = path.join(CURSOR_ROOT, "aaac");
export const STATE_ROOT = path.join(AAAC_ROOT, "state");
export const RUNS_ROOT = path.join(STATE_ROOT, "runs");
export const ACTIVE_RUN_PATH = path.join(STATE_ROOT, "active-run.json");
export const ACTIVE_RUNS_DIR = path.join(STATE_ROOT, "active-runs");
export const REGISTRY_PATH = path.join(AAAC_ROOT, "runtime-registry.json");
export const ENFORCEMENT_PATH = path.join(AAAC_ROOT, "enforcement.json");

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function loadRegistry() {
  const reg = readJson(REGISTRY_PATH);
  if (!reg?.commands) {
    throw new Error(`Missing ${REGISTRY_PATH}. Run: node .cursor/aaac/generate-graph.mjs`);
  }
  return reg;
}

export function loadEnforcement() {
  return readJson(ENFORCEMENT_PATH, {
    edit_phases: ["execute", "sync_inventory", "persist", "write"],
    swarm_min_agents: {},
    allowed_path_prefixes: {},
  });
}

export function conversationIdFromHook(hook) {
  return hook?.conversation_id ?? hook?.conversationId ?? hook?.session_id ?? hook?.sessionId ?? null;
}

export function activeRunPath(conversationId) {
  if (!conversationId) return ACTIVE_RUN_PATH;
  const safe = conversationId.replace(/[^a-zA-Z0-9-]/g, "_");
  return path.join(ACTIVE_RUNS_DIR, `${safe}.json`);
}

export function loadActiveRun(conversationId = null) {
  if (conversationId) return readJson(activeRunPath(conversationId));
  return readJson(ACTIVE_RUN_PATH);
}

export function saveActiveRun(conversationId, data) {
  if (!conversationId) {
    writeJson(ACTIVE_RUN_PATH, data);
    return;
  }
  writeJson(activeRunPath(conversationId), data);
}

export function loadRunManifest(runId) {
  return readJson(path.join(RUNS_ROOT, runId, "run.json"));
}

export function runDir(runId) {
  return path.join(RUNS_ROOT, runId);
}

export function parseAaacPrompt(text) {
  if (!text || typeof text !== "string") return null;
  const registry = loadRegistry();
  const trimmed = text.trim();
  const match = trimmed.match(/^\/([a-z][a-z0-9-]*)(?:\s+(\S+))?(?:\s+"([^"]*)"|(?:\s+([\s\S]+))?)?$/);
  if (!match) return null;
  let command = match[1];
  const aliasTarget = registry.aliases?.[command];
  if (aliasTarget) command = aliasTarget;
  if (!registry.commands[command]) return null;
  let domain = match[2] ?? null;
  let intent = (match[3] ?? match[4] ?? "").trim();
  if (domain && (domain.includes(" ") || domain.startsWith('"'))) {
    intent = `${domain} ${intent}`.trim();
    domain = null;
  }
  if (domain && !intent && !domain.match(/^[a-z]+$/)) {
    intent = domain;
    domain = null;
  }
  return { command, domain, intent, raw: trimmed };
}

export function resolvePending(command, registry) {
  const entry = registry.commands[command];
  if (!entry?.pending?.length) throw new Error(`No pending phases for command: ${command}`);
  return entry.pending;
}

export function slugify(s) {
  return (s || "run").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function isoNow() {
  return new Date().toISOString();
}

export function isGatePhase(phase, registry) {
  return Boolean(registry.gate_phases?.[phase]);
}

export function isEditPhase(phase, enforcement) {
  return enforcement.edit_phases.includes(phase);
}

export function isArtifactPath(filePath, enforcement) {
  const normalized = filePath.replace(/\\/g, "/");
  const prefixes = [
    ...(enforcement.allowed_path_prefixes?.run_artifacts ?? []),
    ...(enforcement.allowed_path_prefixes?.write_article ?? []),
  ];
  return prefixes.some((p) => normalized.includes(p.replace(/^\.\//, "")));
}

export function phaseKind(phase, registry) {
  return isGatePhase(phase, registry) ? "gate" : "work";
}

export function promptFromHook(hook) {
  return hook?.prompt ?? hook?.text ?? hook?.content ?? "";
}
