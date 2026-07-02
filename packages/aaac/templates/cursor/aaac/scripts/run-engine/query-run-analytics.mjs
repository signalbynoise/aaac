#!/usr/bin/env node
/**
 * Query AAAC run analytics from Supabase (PostgREST).
 * Usage: node query-run-analytics.mjs [--workspace-root path] [--run-id id] [--json]
 */
import {
  getSupabasePersistConfig,
  isRunPersistEnabled,
  buildPostgrestHeaders,
} from "./persist-run.mjs";
import { REPO_ROOT, applyWorkspaceEnv } from "./lib.mjs";

async function postgrestGet(config, tablePath) {
  const res = await fetch(`${config.url}/rest/v1/${tablePath}`, {
    headers: buildPostgrestHeaders(config, { Accept: "application/json" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostgREST GET ${tablePath}: ${res.status} ${text}`);
  }
  return res.json();
}

/** @param {string} [workspaceRoot] */
export async function fetchWorkspaceAnalytics(workspaceRoot = REPO_ROOT) {
  const config = getSupabasePersistConfig();
  if (!config) {
    return { ok: true, enabled: false, workspace_root: workspaceRoot };
  }

  const filter = encodeURIComponent(workspaceRoot);
  const runs = await postgrestGet(
    config,
    `aaac_runs?workspace_root=eq.${filter}&select=run_id,status,command,updated_at,synced_at&order=updated_at.desc&limit=500`,
  );

  const byStatus = {};
  const byCommand = {};
  for (const run of runs) {
    byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
    byCommand[run.command] = (byCommand[run.command] ?? 0) + 1;
  }

  return {
    ok: true,
    enabled: true,
    workspace_root: workspaceRoot,
    total_runs: runs.length,
    by_status: byStatus,
    by_command: byCommand,
    last_synced_at: runs[0]?.synced_at ?? null,
    recent_runs: runs.slice(0, 10),
  };
}

/** @param {string} runId */
export async function fetchRunDbRecord(runId) {
  const config = getSupabasePersistConfig();
  if (!config) return { ok: true, enabled: false, run_id: runId };

  const rows = await postgrestGet(
    config,
    `aaac_runs?run_id=eq.${encodeURIComponent(runId)}&select=run_id,status,phase,synced_at,updated_at,created_at`,
  );
  const events = await postgrestGet(
    config,
    `aaac_run_events?run_id=eq.${encodeURIComponent(runId)}&select=event&limit=1000`,
  );
  const artifacts = await postgrestGet(
    config,
    `aaac_run_artifacts?run_id=eq.${encodeURIComponent(runId)}&select=rel_path,byte_size&order=rel_path`,
  );

  return {
    ok: true,
    enabled: true,
    run_id: runId,
    persisted: rows.length > 0,
    run: rows[0] ?? null,
    event_count: events.length,
    artifact_count: artifacts.length,
    artifacts,
  };
}

function isMain() {
  return (process.argv[1] ?? "").endsWith("query-run-analytics.mjs");
}

if (isMain()) {
  applyWorkspaceEnv();
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");
  const runIdx = args.indexOf("--run-id");
  const wsIdx = args.indexOf("--workspace-root");
  const workspaceRoot =
    wsIdx >= 0 ? args[wsIdx + 1] : REPO_ROOT;

  if (!isRunPersistEnabled()) {
    const out = { ok: false, enabled: false, error: "persist_disabled" };
    console.log(JSON.stringify(out, null, jsonOut ? 0 : 2));
    process.exit(1);
  }

  const task =
    runIdx >= 0 && args[runIdx + 1]
      ? fetchRunDbRecord(args[runIdx + 1])
      : fetchWorkspaceAnalytics(workspaceRoot);

  task
    .then((result) => {
      console.log(JSON.stringify(result, null, jsonOut ? 0 : 2));
    })
    .catch((err) => {
      console.error(String(err.message ?? err));
      process.exit(1);
    });
}
