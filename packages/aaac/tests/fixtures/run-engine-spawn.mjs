import { spawn } from 'node:child_process';
import path from 'node:path';
import { RUN_ENGINE_DIR, REPO_ROOT } from './paths.mjs';

/**
 * Run a run-engine CLI script with optional stdin JSON.
 * @returns {{ code: number, stdout: string, stderr: string, json: object|null }}
 */
export function spawnRunEngine(script, args = [], stdinObj = null) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(RUN_ENGINE_DIR, script);
    const proc = spawn('node', [scriptPath, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('error', reject);

    if (stdinObj != null) {
      proc.stdin.write(JSON.stringify(stdinObj));
    }
    proc.stdin.end();

    proc.on('close', (code) => {
      const trimmed = stdout.trim();
      let json = null;
      if (trimmed) {
        try {
          json = JSON.parse(trimmed);
        } catch {
          json = null;
        }
      }
      resolve({ code: code ?? 1, stdout, stderr, json });
    });
  });
}

export async function recordTaskLaunch(conversationId) {
  return spawnRunEngine('record-task.mjs', [], { conversation_id: conversationId });
}

export async function initRun(hookPayload) {
  return spawnRunEngine('init-run.mjs', [], hookPayload);
}

export async function advancePhase(runId, completedPhase, force = false) {
  const args = [runId, completedPhase];
  if (force) args.push('--force');
  return spawnRunEngine('advance-phase.mjs', args);
}

export async function gateWrite(hookPayload) {
  return spawnRunEngine('gate-write.mjs', [], hookPayload);
}
