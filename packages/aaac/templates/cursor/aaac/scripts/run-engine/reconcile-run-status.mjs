#!/usr/bin/env node
/**
 * Run status reconciliation — prevent runs stuck in `running` forever.
 *
 * - Supersede incomplete runs when a new command starts in the same chat/session.
 * - Mark stale runs (no manifest activity) as failed.
 * - Sync session + active-run sidecars to match manifest terminal status.
 */
import fs from "fs";
import {
  RUNS_ROOT,
  SESSIONS_DIR,
  isoNow,
  loadRunManifest,
  loadActiveRun,
  runDir,
  writeJson,
  saveActiveRun,
  clearActiveRun,
  saveSessionRun,
} from "./lib.mjs";
import { recordLog } from "./log.mjs";
import { finalizeRunMetrics } from "./swarm-telemetry.mjs";

export const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function resolveStaleRunMs() {
  if (process.env.AAAC_RECONCILE_STALE === "0") return null;
  const raw = process.env.AAAC_STALE_RUN_MS;
  if (raw != null && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 60 * 60 * 1000;
}

export function isRunStale(manifest, { now = Date.now(), staleMs = resolveStaleRunMs() } = {}) {
  if (!staleMs || isTerminalRunStatus(manifest.status)) return false;
  const updatedAt = manifest.updated_at ?? manifest.created_at;
  if (!updatedAt) return false;
  const ts = Date.parse(updatedAt);
  if (Number.isNaN(ts)) return false;
  return now - ts >= staleMs;
}

export function syncRunSidecars(manifest, { clearActiveWhenTerminal = true } = {}) {
  if (manifest.session_id) {
    saveSessionRun(manifest.session_id, {
      run_id: manifest.run_id,
      session_id: manifest.session_id,
      command: manifest.command,
      phase: manifest.phase,
      status: manifest.status,
      origin: manifest.origin ?? null,
      started_at: manifest.created_at,
      updated_at: manifest.updated_at,
    });
  }

  if (!manifest.conversation_id) return;

  const active = loadActiveRun(manifest.conversation_id);
  if (active?.run_id !== manifest.run_id) return;

  if (isTerminalRunStatus(manifest.status) && clearActiveWhenTerminal) {
    clearActiveRun(manifest.conversation_id);
    return;
  }

  saveActiveRun(manifest.conversation_id, {
    run_id: manifest.run_id,
    conversation_id: manifest.conversation_id,
    command: manifest.command,
    phase: manifest.phase,
    status: manifest.status,
    task_launches_this_phase: manifest.swarm?.task_launches_this_phase ?? 0,
    edit_allowed: manifest.enforcement?.edit_allowed ?? false,
    started_at: manifest.created_at,
  });
}

export function markRunTerminal(manifest, status, reason, { event, level = "warn" } = {}) {
  if (isTerminalRunStatus(manifest.status)) return manifest;

  manifest.status = status;
  manifest.blocked_reason = reason;
  manifest.awaiting_approval = false;
  manifest.updated_at = isoNow();
  if (manifest.enforcement) {
    manifest.enforcement.edit_allowed = false;
  }

  recordLog(manifest, {
    event: event ?? `run_${status}`,
    phase: manifest.phase,
    phase_kind: manifest.phase_kind,
    detail: reason,
    level,
  });

  return manifest;
}

export function markRunSuperseded(manifest, newRunId) {
  return markRunTerminal(manifest, "cancelled", `Superseded by ${newRunId}`, {
    event: "run_superseded",
    level: "info",
  });
}

export function markRunAbandoned(manifest, staleMs) {
  const minutes = Math.round(staleMs / 60_000);
  return markRunTerminal(
    manifest,
    "failed",
    `Run abandoned after ${minutes} minutes with no activity`,
    { event: "run_abandoned" },
  );
}

export function persistReconciledRun(manifest) {
  finalizeRunMetrics(manifest);
  writeJson(`${runDir(manifest.run_id)}/run.json`, manifest);
  syncRunSidecars(manifest);
  return manifest;
}

export function listRunIds() {
  if (!fs.existsSync(RUNS_ROOT)) return [];
  return fs
    .readdirSync(RUNS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run_"))
    .map((entry) => entry.name);
}

export function findIncompleteRuns({
  conversationId = null,
  sessionId = null,
  excludeRunId = null,
} = {}) {
  const matches = [];
  for (const runId of listRunIds()) {
    if (excludeRunId && runId === excludeRunId) continue;
    const manifest = loadRunManifest(runId);
    if (!manifest || isTerminalRunStatus(manifest.status)) continue;
    if (conversationId && manifest.conversation_id === conversationId) {
      matches.push(runId);
      continue;
    }
    if (sessionId && manifest.session_id === sessionId) {
      matches.push(runId);
    }
  }
  return matches;
}

export function supersedeIncompleteRuns(
  { conversationId = null, sessionId = null, newRunId },
  { persist = true } = {},
) {
  const superseded = [];
  for (const runId of findIncompleteRuns({ conversationId, sessionId, excludeRunId: newRunId })) {
    const manifest = loadRunManifest(runId);
    if (!manifest) continue;
    markRunSuperseded(manifest, newRunId);
    if (persist) persistReconciledRun(manifest);
    superseded.push(runId);
  }
  return superseded;
}

export function reconcileStaleRun(manifest, options = {}) {
  const staleMs = options.staleMs ?? resolveStaleRunMs();
  if (!staleMs || !isRunStale(manifest, { ...options, staleMs })) {
    return { changed: false, manifest };
  }
  markRunAbandoned(manifest, staleMs);
  return { changed: true, manifest };
}

export function reconcileAllStaleRuns({ persist = true, ...options } = {}) {
  const staleMs = options.staleMs ?? resolveStaleRunMs();
  if (!staleMs) return { reconciled: [], skipped: true };

  const reconciled = [];
  for (const runId of listRunIds()) {
    const manifest = loadRunManifest(runId);
    if (!manifest) continue;
    const result = reconcileStaleRun(manifest, { ...options, staleMs });
    if (!result.changed) continue;
    if (persist) persistReconciledRun(result.manifest);
    reconciled.push(runId);
  }
  return { reconciled, skipped: false };
}

function isMain() {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("reconcile-run-status.mjs");
}

if (isMain()) {
  const jsonOut = process.argv.includes("--json");
  const result = reconcileAllStaleRuns();
  const payload = { ok: true, ...result };
  if (jsonOut) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      result.skipped
        ? "Stale reconciliation disabled (AAAC_RECONCILE_STALE=0)"
        : `Reconciled ${result.reconciled.length} stale run(s): ${result.reconciled.join(", ") || "none"}`,
    );
  }
}
