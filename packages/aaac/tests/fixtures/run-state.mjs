import fs from 'node:fs';
import path from 'node:path';
import {
  ACTIVE_RUNS_DIR,
  REPO_ROOT,
  RUNS_ROOT,
} from './paths.mjs';
import { CONVERSATION_ID } from './hook-payloads.mjs';

let counter = 0;

export function nextRunId(label) {
  counter += 1;
  return `run_test_${Date.now()}_${counter}_${label}`;
}

export function conversationActivePath(conversationId) {
  const safe = conversationId.replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(ACTIVE_RUNS_DIR, `${safe}.json`);
}

export function runManifestPath(runId) {
  return path.join(RUNS_ROOT, runId, 'run.json');
}

export function runArtifactsDir(runId) {
  return path.join(RUNS_ROOT, runId, 'artifacts');
}

/** Write manifest + active-run pointer; returns paths for cleanup. */
export function seedRun(manifest, conversationId = CONVERSATION_ID) {
  const runId = manifest.run_id;
  const runDir = path.join(RUNS_ROOT, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(runManifestPath(runId), `${JSON.stringify(manifest, null, 2)}\n`);

  const active = {
    run_id: runId,
    conversation_id: conversationId,
    command: manifest.command,
    phase: manifest.phase,
    status: manifest.status,
    task_launches_this_phase: manifest.swarm?.task_launches_this_phase ?? 0,
    edit_allowed: manifest.enforcement?.edit_allowed ?? false,
    started_at: manifest.created_at,
  };
  fs.mkdirSync(ACTIVE_RUNS_DIR, { recursive: true });
  fs.writeFileSync(
    conversationActivePath(conversationId),
    `${JSON.stringify(active, null, 2)}\n`,
  );

  return { runId, runDir, activePath: conversationActivePath(conversationId) };
}

export function writeArtifact(runId, relativePath, content = '# fixture\n') {
  const full = path.join(RUNS_ROOT, runId, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

export function cleanupRun(runId, conversationId = CONVERSATION_ID) {
  const runDir = path.join(RUNS_ROOT, runId);
  if (fs.existsSync(runDir)) {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  const activePath = conversationActivePath(conversationId);
  if (fs.existsSync(activePath)) {
    fs.unlinkSync(activePath);
  }
}

/** Artifact path under repo that gate-write treats as allowed. */
export function artifactFilePath(runId, relative = 'artifacts/plan.yaml') {
  return path.join(REPO_ROOT, '.cursor/aaac/state/runs', runId, relative);
}
