#!/usr/bin/env node
/**
 * Sync AAAC Run manifest + artifacts to Supabase (PostgREST).
 * Enable when SUPABASE URL + service role key are set; disable with AAAC_PERSIST_RUNS=0.
 */
import fs from "fs";
import path from "path";
import {
  REPO_ROOT,
  RUNS_ROOT,
  SESSIONS_DIR,
  loadRunManifest,
  runDir,
  isoNow,
  applyWorkspaceEnv,
} from "./lib.mjs";

export const MAX_INLINE_ARTIFACT_BYTES = 512 * 1024;

const debounceTimers = new Map();
const DEBOUNCE_MS = 400;

/** @returns {{ url: string, key: string } | null} */
export function getSupabasePersistConfig() {
  if (process.env.AAAC_PERSIST_RUNS === "0") return null;

  const url =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    null;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    null;

  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function isRunPersistEnabled() {
  return getSupabasePersistConfig() !== null;
}

/** Opaque sb_* keys must use apikey only — Bearer triggers JWT parse errors (401). */
export function buildPostgrestHeaders(config, extra = {}) {
  const headers = {
    apikey: config.key,
    "Content-Type": "application/json",
    ...extra,
  };
  const isOpaqueKey =
    config.key.startsWith("sb_secret_") || config.key.startsWith("sb_publishable_");
  if (!isOpaqueKey) {
    headers.Authorization = `Bearer ${config.key}`;
  }
  return headers;
}

function contentTypeForPath(relPath) {
  if (relPath.endsWith(".json")) return "application/json";
  if (relPath.endsWith(".yaml") || relPath.endsWith(".yml")) return "text/yaml";
  if (relPath.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

/** @param {object} manifest */
export function buildRunRow(manifest, workspaceRoot = REPO_ROOT) {
  return {
    run_id: manifest.run_id,
    workspace_root: workspaceRoot,
    origin: manifest.origin ?? null,
    session_id: manifest.session_id ?? null,
    conversation_id: manifest.conversation_id ?? null,
    command: manifest.command,
    verb: manifest.verb ?? null,
    object: manifest.object ?? null,
    domain: manifest.domain ?? null,
    intent: manifest.intent ?? null,
    orchestrator: manifest.orchestrator ?? null,
    status: manifest.status,
    phase: manifest.phase ?? null,
    phase_kind: manifest.phase_kind ?? null,
    awaiting_approval: Boolean(manifest.awaiting_approval),
    blocked_reason: manifest.blocked_reason ?? null,
    pending: manifest.pending ?? [],
    completed: manifest.completed ?? [],
    execution: manifest.execution ?? null,
    confidence: manifest.confidence ?? null,
    gates: manifest.gates ?? null,
    swarm: manifest.swarm ?? null,
    context: manifest.context ?? null,
    capabilities_resolved: manifest.capabilities_resolved ?? null,
    capability_runtime: manifest.capability_runtime ?? null,
    capability_runtime_approved: Boolean(manifest.capability_runtime_approved),
    capability_evidence_processed: Boolean(manifest.capability_evidence_processed),
    capability_evidence_outcomes: manifest.capability_evidence_outcomes ?? null,
    enforcement: manifest.enforcement ?? null,
    manifest,
    created_at: manifest.created_at ?? isoNow(),
    updated_at: manifest.updated_at ?? isoNow(),
    synced_at: isoNow(),
  };
}

/** @param {object} manifest */
export function buildEventRows(manifest) {
  const runId = manifest.run_id;
  return (manifest.log ?? []).map((entry, index) => ({
    run_id: runId,
    event_seq: index,
    at: entry.at ?? isoNow(),
    phase: entry.phase ?? null,
    phase_kind: entry.phase_kind ?? null,
    skill: entry.skill ?? null,
    event: entry.event,
    detail: entry.detail ?? null,
    level: entry.level ?? null,
  }));
}

/** @param {object} manifest */
export function buildDecisionRows(manifest) {
  const runId = manifest.run_id;
  return (manifest.decisions ?? []).map((entry, index) => ({
    run_id: runId,
    decision_seq: index,
    at: entry.at ?? isoNow(),
    phase: entry.phase ?? null,
    decision: entry.decision,
    reason: entry.reason ?? null,
    evidence: entry.evidence ?? null,
  }));
}

/** @param {object} manifest */
export function buildPhaseRows(manifest) {
  const runId = manifest.run_id;
  const phases = manifest.context?.phases ?? {};
  return Object.entries(phases).map(([phase, telemetry]) => ({
    run_id: runId,
    phase,
    artifact_bytes: telemetry?.artifact_bytes ?? null,
    compaction_applied: telemetry?.compaction_applied ?? null,
    estimated_utilization: telemetry?.estimated_utilization ?? null,
    evidence_lines_trimmed: telemetry?.evidence_lines_trimmed ?? null,
    tokens: telemetry?.tokens ?? manifest.phase_metrics?.[phase]?.tokens ?? null,
    duration_ms: telemetry?.duration_ms ?? manifest.phase_metrics?.[phase]?.duration_ms ?? null,
    context_score:
      manifest.phase_metrics?.[phase]?.context ?? telemetry?.estimated_utilization ?? null,
    swarm_count: telemetry?.swarm_count ?? null,
  }));
}

/** @param {object} manifest */
export function buildAgentRows(manifest) {
  const runId = manifest.run_id;
  const rows = [];
  const seen = new Set();

  const pushAgent = (agent, phase) => {
    const key = `${phase}:${agent.index ?? rows.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      run_id: runId,
      phase,
      agent_index: agent.index ?? rows.length + 1,
      subagent_type: agent.subagent_type ?? null,
      description: agent.description ?? null,
      model: agent.model ?? null,
      readonly: agent.readonly ?? null,
      started_at: agent.started_at ?? agent.at ?? null,
      completed_at: agent.completed_at ?? null,
      duration_ms: agent.duration_ms ?? null,
      tokens: agent.tokens ?? null,
      context_score: agent.context ?? null,
      cursor_run_id: agent.cursor_run_id ?? null,
    });
  };

  for (const agent of manifest.swarm?.agents ?? []) {
    if (agent.phase) pushAgent(agent, agent.phase);
  }

  for (const [phase, snapshot] of Object.entries(manifest.swarm_history ?? {})) {
    for (const agent of snapshot.agents ?? []) {
      pushAgent(agent, phase);
    }
  }

  return rows;
}

/** @param {object} manifest */
export function buildCapabilityRows(manifest) {
  const runId = manifest.run_id;
  const resolved = manifest.capabilities_resolved ?? {};
  const outcomes = manifest.capability_evidence_outcomes ?? [];
  const outcomeById = Object.fromEntries(
    outcomes.map((o) => [o.capability_id, o]),
  );

  const ids = new Set([
    ...Object.keys(resolved),
    ...outcomes.map((o) => o.capability_id),
  ]);

  return [...ids].map((capabilityId) => ({
    run_id: runId,
    capability_id: capabilityId,
    providers: resolved[capabilityId]?.providers ?? null,
    runtime: resolved[capabilityId]?.runtime ?? null,
    evidence_outcome: outcomeById[capabilityId] ?? null,
  }));
}

function listArtifactFiles(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listArtifactFiles(full, rel));
    } else {
      files.push({ rel_path: rel, full_path: full });
    }
  }
  return files;
}

/** Strip NUL bytes — Postgres text columns reject \\u0000 (22P05). */
export function sanitizeArtifactBody(text) {
  if (text == null) return null;
  return text.includes("\0") ? text.replaceAll("\0", "") : text;
}

/** @param {string} runId */
export function buildArtifactRows(runId) {
  const artifactsDir = path.join(runDir(runId), "artifacts");
  const now = isoNow();
  return listArtifactFiles(artifactsDir).map(({ rel_path, full_path }) => {
    const normalizedPath = rel_path.startsWith("artifacts/")
      ? rel_path
      : `artifacts/${rel_path}`;
    const stat = fs.statSync(full_path);
    const byteSize = stat.size;
    let body = null;
    if (byteSize <= MAX_INLINE_ARTIFACT_BYTES) {
      body = sanitizeArtifactBody(fs.readFileSync(full_path, "utf8"));
    }
    return {
      run_id: runId,
      rel_path: normalizedPath,
      content_type: contentTypeForPath(normalizedPath),
      byte_size: byteSize,
      body,
      storage_url: null,
      updated_at: now,
    };
  });
}

/** @param {object} manifest */
export function buildSessionRow(manifest, workspaceRoot = REPO_ROOT) {
  if (!manifest.session_id) return null;
  return {
    session_id: manifest.session_id,
    run_id: manifest.run_id,
    origin: manifest.origin ?? null,
    workspace_root: workspaceRoot,
    command: manifest.command ?? null,
    phase: manifest.phase ?? null,
    status: manifest.status ?? null,
    started_at: manifest.created_at ?? null,
    updated_at: manifest.updated_at ?? isoNow(),
  };
}

async function postgrestRequest(config, method, tablePath, { body, prefer } = {}) {
  const headers = buildPostgrestHeaders(
    config,
    prefer ? { Prefer: prefer } : {},
  );

  const res = await fetch(`${config.url}/rest/v1/${tablePath}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostgREST ${method} ${tablePath}: ${res.status} ${text}`);
  }
}

async function upsertRows(config, table, rows) {
  if (!rows.length) return;
  await postgrestRequest(config, "POST", table, {
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function deleteRunChildren(config, table, runId) {
  const filter = encodeURIComponent(runId);
  await postgrestRequest(
    config,
    "DELETE",
    `${table}?run_id=eq.${filter}`,
  );
}

/**
 * @param {string} runId
 * @param {object} [options]
 * @param {object} [options.manifest]
 * @param {string} [options.workspaceRoot]
 * @param {{ url: string, key: string }} [options.config]
 */
export async function syncRunToSupabase(runId, options = {}) {
  if (!options.config) {
    applyWorkspaceEnv(options.workspaceRoot ?? REPO_ROOT);
  }
  const config = options.config ?? getSupabasePersistConfig();
  if (!config) {
    return { ok: true, skipped: true, reason: "persist_disabled" };
  }

  const manifest = options.manifest ?? loadRunManifest(runId);
  if (!manifest?.run_id) {
    return { ok: false, skipped: true, reason: "manifest_not_found" };
  }

  const workspaceRoot = options.workspaceRoot ?? REPO_ROOT;
  const runRow = buildRunRow(manifest, workspaceRoot);
  const eventRows = buildEventRows(manifest);
  const decisionRows = buildDecisionRows(manifest);
  const phaseRows = buildPhaseRows(manifest);
  const agentRows = buildAgentRows(manifest);
  const capabilityRows = buildCapabilityRows(manifest);
  const artifactRows = buildArtifactRows(runId);
  const sessionRow = buildSessionRow(manifest, workspaceRoot);

  await upsertRows(config, "aaac_runs", [runRow]);

  for (const table of [
    "aaac_run_events",
    "aaac_run_decisions",
    "aaac_run_phases",
    "aaac_run_agents",
    "aaac_run_capabilities",
    "aaac_run_artifacts",
  ]) {
    await deleteRunChildren(config, table, runId);
  }

  await upsertRows(config, "aaac_run_events", eventRows);
  await upsertRows(config, "aaac_run_decisions", decisionRows);
  await upsertRows(config, "aaac_run_phases", phaseRows);
  await upsertRows(config, "aaac_run_agents", agentRows);
  await upsertRows(config, "aaac_run_capabilities", capabilityRows);
  await upsertRows(config, "aaac_run_artifacts", artifactRows);

  if (sessionRow) {
    await upsertRows(config, "aaac_sessions", [sessionRow]);
  }

  return {
    ok: true,
    run_id: runId,
    events: eventRows.length,
    decisions: decisionRows.length,
    artifacts: artifactRows.length,
  };
}

/** Debounced fire-and-forget persist after manifest write. */
export function scheduleRunPersist(runId, manifest) {
  if (!runId || !isRunPersistEnabled()) return;

  const existing = debounceTimers.get(runId);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    runId,
    setTimeout(() => {
      debounceTimers.delete(runId);
      applyWorkspaceEnv();
      syncRunToSupabase(runId, { manifest }).catch((err) => {
        process.stderr.write(
          `[warn] [persist-run:sync_failed] ${runId} ${String(err.message ?? err)}\n`,
        );
      });
    }, DEBOUNCE_MS),
  );
}

/** Sync session index file when present. */
export function scheduleSessionPersist(sessionId) {
  if (!sessionId || !isRunPersistEnabled()) return;
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const sessionPath = path.join(SESSIONS_DIR, `${safe}.json`);
  if (!fs.existsSync(sessionPath)) return;

  try {
    const data = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    if (!data.run_id) return;
    const manifest = loadRunManifest(data.run_id);
    if (manifest) scheduleRunPersist(data.run_id, manifest);
  } catch {
    // non-fatal
  }
}

async function syncAllRuns() {
  if (!fs.existsSync(RUNS_ROOT)) {
    console.error("No runs directory");
    process.exit(1);
  }
  const dirs = fs
    .readdirSync(RUNS_ROOT)
    .filter((name) => name.startsWith("run_"));
  let ok = 0;
  let fail = 0;
  for (const runId of dirs) {
    try {
      const result = await syncRunToSupabase(runId);
      if (result.ok && !result.skipped) ok += 1;
    } catch (err) {
      fail += 1;
      process.stderr.write(`${runId}: ${err.message}\n`);
    }
  }
  console.log(JSON.stringify({ ok: true, synced: ok, failed: fail }));
}

function isMain() {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("persist-run.mjs");
}

if (isMain()) {
  applyWorkspaceEnv();
  const args = process.argv.slice(2);
  const runIdx = args.indexOf("--run-id");
  const all = args.includes("--all");

  if (!isRunPersistEnabled()) {
    console.error("Persist disabled: set SUPABASE URL + service role key, or AAAC_PERSIST_RUNS=0");
    process.exit(1);
  }

  if (all) {
    syncAllRuns().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else if (runIdx >= 0 && args[runIdx + 1]) {
    syncRunToSupabase(args[runIdx + 1])
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.ok ? 0 : 1);
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else {
    console.error("Usage: persist-run.mjs --run-id <id> | --all");
    process.exit(1);
  }
}
