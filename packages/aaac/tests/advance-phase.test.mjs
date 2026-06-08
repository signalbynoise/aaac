import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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
  checkModuleManifest,
} from './fixtures/sample-manifests.mjs';
import {
  advancePhase,
  recordTaskLaunch,
} from './fixtures/run-engine-spawn.mjs';
import { loadEnforcement } from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import { REPO_ROOT } from './fixtures/paths.mjs';

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

  it('check verb discover requires check_swarm minimum (3), not discover (4)', async () => {
    const conversationId = uniqueConversationId('advance-check-discover');
    const runId = nextRunId('advance-check-discover');
    seedRun(checkModuleManifest('discover', runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    for (let i = 0; i < 2; i += 1) {
      await recordTaskLaunch(conversationId);
    }
    const tooFew = await advancePhase(runId, 'discover');
    expect(tooFew.code).toBe(2);
    expect(tooFew.stderr).toMatch(/Swarm incomplete/);

    await recordTaskLaunch(conversationId);
    const ok = await advancePhase(runId, 'discover');
    expect(ok.code).toBe(0);
    expect(ok.json?.phase).toBe('validate');
  });

  it('create verify requires verify swarm minimum (3)', async () => {
    const conversationId = uniqueConversationId('advance-verify-swarm');
    const runId = nextRunId('advance-verify-swarm');
    seedRun(createModuleManifest('verify', runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    const tooFew = await advancePhase(runId, 'verify');
    expect(tooFew.code).toBe(2);
    expect(tooFew.stderr).toMatch(/Swarm incomplete/);

    for (let i = 0; i < 3; i += 1) {
      await recordTaskLaunch(conversationId);
    }
    writeArtifact(runId, 'artifacts/verify.yaml', 'status: pass\n');
    const result = await advancePhase(runId, 'verify', true);
    expect(result.code).toBe(0);
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
    manifest.capabilities_resolved = {
      'layer-boundaries': {
        providers: [{ id: 'architecture', type: 'skill' }],
        source: 'object module',
        runtime: { state: 'trusted', invocations: 50, success_rate: 0.95, avg_fitness: 90 },
      },
    };
    writeArtifact(runId, 'artifacts/plan.yaml', 'tests_to_add: []\nsteps: []\n');
    writeArtifact(runId, 'artifacts/rollback.yaml', 'verified: true\n');
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const result = await advancePhase(runId, 'rollback');
    expect(result.code).toBe(0);
    expect(result.json?.phase).toBe('execute');
    expect(result.json?.edit_allowed).toBe(true);
  });

  it('blocks execute when capability runtime policy requires approval', async () => {
    const conversationId = uniqueConversationId('advance-cap-runtime');
    const runId = nextRunId('advance-cap-runtime');
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
    manifest.capabilities_resolved = {
      'layer-boundaries': {
        providers: [{ id: 'architecture', type: 'skill' }],
        source: 'object module',
        runtime: { state: 'experimental', invocations: 0, success_rate: null, avg_fitness: null },
      },
    };
    writeArtifact(runId, 'artifacts/rollback.yaml', 'verified: true\n');
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const result = await advancePhase(runId, 'rollback');
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Capability runtime require_approval/);

    const updated = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
    expect(updated.status).toBe('blocked');
    expect(updated.awaiting_approval).toBe(true);
  });

  it('blocks verify advance when website verify fails', async () => {
    const conversationId = uniqueConversationId('advance-verify-fail');
    const runId = nextRunId('advance-verify-fail');
    const manifest = createModuleManifest('verify', runId, conversationId);
    manifest.verb = 'create';
    manifest.completed = [
      'discover',
      'investigate_lite',
      'plan',
      'validate',
      'impact_analysis',
      'dependency_graph',
      'fitness_functions',
      'rollback',
      'execute',
    ];
    manifest.pending = ['report'];
    writeArtifact(runId, 'artifacts/plan.yaml', 'tests_to_add: []\nsteps: []\n');
    writeArtifact(runId, 'artifacts/rollback.yaml', 'verified: true\n');
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    for (let i = 0; i < 3; i += 1) {
      await recordTaskLaunch(conversationId);
    }

    const indexPath = path.join(REPO_ROOT, 'apps/website/index.html');
    const backup = `${indexPath}.bak-advance-test`;
    fs.renameSync(indexPath, backup);
    fs.writeFileSync(
      indexPath,
      '<link rel="icon" href="/missing-for-advance-test.svg" />',
    );

    try {
      const result = await advancePhase(runId, 'verify');
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/App verify failed/);
    } finally {
      fs.unlinkSync(indexPath);
      fs.renameSync(backup, indexPath);
    }
  });

  it('rejects plan advance when tests_to_add is missing for create verb', async () => {
    const conversationId = uniqueConversationId('advance-plan-tests');
    const runId = nextRunId('advance-plan-tests');
    seedRun(createModuleManifest('plan', runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    writeArtifact(runId, 'artifacts/plan.yaml', 'steps: []\n');
    const result = await advancePhase(runId, 'plan');
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/tests_to_add/);
  });

  it('rejects test_execute advance when tests required but files_written empty', async () => {
    const conversationId = uniqueConversationId('advance-test-exec-gate');
    const runId = nextRunId('advance-test-exec-gate');
    const manifest = createModuleManifest('test_execute', runId, conversationId);
    manifest.completed = [
      'discover',
      'investigate_lite',
      'plan',
      'validate',
      'impact_analysis',
      'dependency_graph',
      'fitness_functions',
      'rollback',
      'execute',
    ];
    manifest.pending = ['verify', 'review_swarm', 'report'];
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    writeArtifact(
      runId,
      'artifacts/plan.yaml',
      'tests_to_add:\n  - behavior: sum weekly downloads\n    kind: unit\n',
    );
    writeArtifact(
      runId,
      'artifacts/test_plan.yaml',
      'unit_tests:\n  - path: foo.test.ts\n    status: deferred\n',
    );
    await recordTaskLaunch(conversationId);

    const result = await advancePhase(runId, 'test_execute');
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/files_written|defer/i);
  });
});
