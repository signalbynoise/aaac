import fs from 'node:fs';
import {
  loadEnforcement,
  resolveSwarmMinimum,
} from '../../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import { resolveSwarmTarget } from '../../src/run-engine/resolve-swarm-target.mjs';
import { resolveExpectedAgentSpecs } from '../../src/run-engine/expected-agent-specs.mjs';
import { resolvePhaseArtifacts } from '../../../../.cursor/aaac/scripts/run-engine/context-budget.mjs';
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

async function satisfySwarm(conversationId, phase, runId) {
  const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
  const enforcement = loadEnforcement();
  const min =
    manifest.swarm?.target_agents?.[phase] ??
    resolveSwarmTarget(phase, manifest, enforcement) ??
    resolveSwarmMinimum(phase, manifest, enforcement) ??
    0;
  for (let i = 0; i < min; i += 1) {
    await recordTaskLaunch(conversationId);
  }
}

async function satisfyArtifacts(runId, phase, manifest) {
  const enforcement = loadEnforcement();
  const required = resolvePhaseArtifacts(phase, manifest, enforcement);
  for (const rel of required) {
    if (rel === 'artifacts/plan.yaml') {
      writeArtifact(runId, rel, 'tests_to_add: []\nsteps: []\n');
    } else if (rel === 'artifacts/test_plan.yaml') {
      writeArtifact(
        runId,
        rel,
        'tests_to_add: []\nskipped_reason: integration flow stub\nfiles_written: []\n',
      );
    } else if (rel === 'artifacts/discover_brief.yaml') {
      writeArtifact(runId, rel, 'answer: partial\nsummary: integration stub\n');
    } else if (rel === 'artifacts/discovery-brief.md') {
      writeArtifact(runId, rel, '# Discovery brief\n');
    } else {
      writeArtifact(runId, rel, `# ${rel}\n`);
    }
  }
}

function assertCurrentPhaseRoster(manifest) {
  if (!manifest.phase) return;
  const expected = resolveExpectedAgentSpecs(manifest);
  if (manifest.swarm?.expected_specs_phase !== manifest.phase) {
    throw new Error(`stale expected roster for ${manifest.phase}`);
  }
  if (JSON.stringify(manifest.swarm?.expected_agent_specs) !== JSON.stringify(expected)) {
    throw new Error(`unexpected graph roster for ${manifest.phase}`);
  }
  if (expected.some((spec) => !spec.initial_summary)) {
    throw new Error(`missing Role summary for ${manifest.phase}`);
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
  assertCurrentPhaseRoster(manifest);

  while (manifest.status === 'running' && manifest.phase !== 'report') {
    const phase = manifest.phase;
    await satisfySwarm(conversationId, phase, runId);
    await satisfyArtifacts(runId, phase, manifest);

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
    assertCurrentPhaseRoster(manifest);
  }

  if (manifest.phase === 'report') {
    await satisfySwarm(conversationId, 'report', runId);
    await satisfyArtifacts(runId, 'report', manifest);
    const final = await advancePhase(runId, 'report');
    if (final.code !== 0) {
      throw new Error(`advance report failed: ${final.stderr}`);
    }
    manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
  }

  return { runId, manifest };
}

export { cleanupRun };
