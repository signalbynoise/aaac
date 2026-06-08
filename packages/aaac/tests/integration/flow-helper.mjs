import fs from 'node:fs';
import {
  loadEnforcement,
  resolveSwarmMinimum,
} from '../../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import {
  advancePhase,
  initRun,
  recordTaskLaunch,
} from '../fixtures/run-engine-spawn.mjs';
import { beforeSubmitPromptHook } from '../fixtures/hook-payloads.mjs';
import {
  cleanupRun,
  runManifestPath,
  writeArtifact,
} from '../fixtures/run-state.mjs';

async function satisfySwarm(conversationId, phase, command, verb) {
  const enforcement = loadEnforcement();
  const min =
    resolveSwarmMinimum(phase, { command, verb }, enforcement) ?? 0;
  for (let i = 0; i < min; i += 1) {
    await recordTaskLaunch(conversationId);
  }
}

async function satisfyArtifacts(runId, phase) {
  const enforcement = loadEnforcement();
  const required = enforcement.phase_artifacts?.[phase] ?? [];
  for (const rel of required) {
    writeArtifact(runId, rel, `# ${rel}\n`);
  }
}

/**
 * Simulate a full AAAC run from init through completion.
 * @returns {{ runId: string, manifest: object }}
 */
export async function simulateVerbFlow(prompt, conversationId) {
  const init = await initRun(beforeSubmitPromptHook(prompt, conversationId));
  if (!init.json?.ok || !init.json?.run_id) {
    throw new Error(`init-run failed: ${init.stderr || init.stdout}`);
  }

  const runId = init.json.run_id;
  let manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));

  while (manifest.status === 'running' && manifest.phase !== 'report') {
    const phase = manifest.phase;
    await satisfySwarm(conversationId, phase, manifest.command, manifest.verb);
    await satisfyArtifacts(runId, phase);

    const forceExecute =
      phase === 'rollback' &&
      (manifest.pending?.[0] === 'execute' || manifest.pending?.includes?.('execute'));
    const result = await advancePhase(runId, phase, forceExecute);
    if (result.code !== 0) {
      throw new Error(
        `advance ${phase} failed (code ${result.code}): ${result.stderr || result.stdout}`,
      );
    }

    manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
  }

  if (manifest.phase === 'report') {
    await satisfyArtifacts(runId, 'report');
    const final = await advancePhase(runId, 'report');
    if (final.code !== 0) {
      throw new Error(`advance report failed: ${final.stderr}`);
    }
    manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
  }

  return { runId, manifest };
}

export { cleanupRun };
