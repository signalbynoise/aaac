import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  seedRun,
  cleanupRun,
  writeArtifact,
  nextRunId,
  runManifestPath,
} from './fixtures/run-state.mjs';
import { uniqueConversationId } from './fixtures/hook-payloads.mjs';
import {
  createModuleManifest,
  fixModuleManifest,
} from './fixtures/sample-manifests.mjs';
import {
  advancePhase,
  recordTaskLaunch,
} from './fixtures/run-engine-spawn.mjs';
import { loadEnforcement } from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';

describe('advance-phase', () => {
  const runs = [];

  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it('rejects advancement when discover swarm minimum is not met', async () => {
    const conversationId = uniqueConversationId('advance-discover-fail');
    const runId = nextRunId('advance-discover-fail');
    seedRun(createModuleManifest('discover', runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    const result = await advancePhase(runId, 'discover');
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Swarm incomplete/);
    expect(result.stderr).toMatch(/discover/);
  });

  it('advances discover after enough Task launches', async () => {
    const conversationId = uniqueConversationId('advance-discover-ok');
    const runId = nextRunId('advance-discover-ok');
    seedRun(createModuleManifest('discover', runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    const min = loadEnforcement().swarm_min_agents.discover;
    for (let i = 0; i < min; i += 1) {
      await recordTaskLaunch(conversationId);
    }

    const result = await advancePhase(runId, 'discover');
    expect(result.code).toBe(0);
    expect(result.json?.phase).toBe('investigate_lite');

    const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
    expect(manifest.completed).toContain('discover');
    expect(manifest.enforcement.edit_allowed).toBe(false);
  });

  it('requires investigate_swarm artifact and swarm for fix-module', async () => {
    const conversationId = uniqueConversationId('advance-investigate');
    const runId = nextRunId('advance-investigate');
    const manifest = fixModuleManifest('investigate_swarm', runId, conversationId);
    manifest.completed = ['discover'];
    manifest.pending = manifest.pending.slice(manifest.pending.indexOf('root_cause'));
    manifest.swarm = { task_launches_this_phase: 7, phase: 'investigate_swarm' };
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const noArtifact = await advancePhase(runId, 'investigate_swarm');
    expect(noArtifact.code).toBe(2);
    expect(noArtifact.stderr).toMatch(/investigation\.md/);

    writeArtifact(runId, 'artifacts/investigation.md', '# investigation\n');
    const ok = await advancePhase(runId, 'investigate_swarm');
    expect(ok.code).toBe(0);
    expect(ok.json?.phase).toBe('root_cause');
  });

  it('rejects phase mismatch', async () => {
    const conversationId = uniqueConversationId('advance-mismatch');
    const runId = nextRunId('advance-mismatch');
    seedRun(createModuleManifest('discover', runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    const result = await advancePhase(runId, 'execute');
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Phase mismatch/);
  });

  it('sets edit_allowed true when entering execute', async () => {
    const conversationId = uniqueConversationId('advance-execute');
    const runId = nextRunId('advance-execute');
    const manifest = createModuleManifest('rollback', runId, conversationId);
    manifest.completed = [
      'discover',
      'investigate_lite',
      'plan',
      'validate',
      'impact_analysis',
      'dependency_graph',
      'fitness_functions',
    ];
    manifest.pending = ['execute', 'verify', 'report'];
    writeArtifact(runId, 'artifacts/plan.yaml', 'steps: []\n');
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const result = await advancePhase(runId, 'rollback');
    expect(result.code).toBe(0);
    expect(result.json?.phase).toBe('execute');
    expect(result.json?.edit_allowed).toBe(true);
  });
});
