/**
 * Resolve the active AAAC run for hooks / CLI gates.
 * Order: AAAC_RUN_ID → conversation/session active-run → cli-latest sidecar → session file.
 */
import path from "path";
import {
  ACTIVE_RUNS_DIR,
  SESSIONS_DIR,
  conversationIdFromHook,
  isoNow,
  loadActiveRun,
  readJson,
  writeJson,
} from "./lib.mjs";

export const CLI_LATEST_FILENAME = "cli-latest.json";

export function cliLatestSidecarPath() {
  return path.join(ACTIVE_RUNS_DIR, CLI_LATEST_FILENAME);
}

/**
 * @param {{
 *   run_id: string,
 *   session_id?: string|null,
 *   agent_index?: number|string|null,
 *   phase?: string|null,
 * }} payload
 */
export function writeCliLatestSidecarAt(workspaceRoot, payload = {}) {
  const runId = String(payload.run_id ?? "").trim();
  if (!runId || !workspaceRoot) return null;
  const record = {
    run_id: runId,
    session_id: payload.session_id ?? null,
    agent_index:
      payload.agent_index != null && payload.agent_index !== ""
        ? Number(payload.agent_index)
        : null,
    phase: payload.phase ?? null,
    written_at: isoNow(),
  };
  writeJson(
    path.join(workspaceRoot, ".cursor/aaac/state/active-runs", CLI_LATEST_FILENAME),
    record,
  );
  return record;
}

export function writeCliLatestSidecar(payload = {}) {
  const runId = String(payload.run_id ?? "").trim();
  if (!runId) return null;
  const record = {
    run_id: runId,
    session_id: payload.session_id ?? null,
    agent_index:
      payload.agent_index != null && payload.agent_index !== ""
        ? Number(payload.agent_index)
        : null,
    phase: payload.phase ?? null,
    written_at: isoNow(),
  };
  writeJson(cliLatestSidecarPath(), record);
  return record;
}

export function loadCliLatestSidecar() {
  return readJson(cliLatestSidecarPath(), null);
}

/**
 * @param {object} [hook]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ runId: string|null, source: string|null }}
 */
export function resolveRunId(hook = {}, env = process.env) {
  const envRun = String(env.AAAC_RUN_ID ?? "").trim();
  if (envRun) return { runId: envRun, source: "env" };

  const conversationId = conversationIdFromHook(hook);
  if (conversationId) {
    const active = loadActiveRun(conversationId);
    if (active?.run_id) return { runId: active.run_id, source: "active_run" };
  }

  const sessionId =
    String(env.AAAC_SESSION_ID ?? "").trim() ||
    hook?.session_id ||
    hook?.sessionId ||
    null;
  if (sessionId) {
    const active = loadActiveRun(sessionId);
    if (active?.run_id) return { runId: active.run_id, source: "session_active" };
    const sess = readJson(path.join(SESSIONS_DIR, `${sessionId}.json`), null);
    if (sess?.run_id) return { runId: sess.run_id, source: "session_file" };
  }

  const sidecar = loadCliLatestSidecar();
  if (sidecar?.run_id) return { runId: String(sidecar.run_id), source: "sidecar" };

  return { runId: null, source: null };
}
