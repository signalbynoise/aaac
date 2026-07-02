import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  seedRun,
  cleanupRun,
  nextRunId,
  runManifestPath,
} from './fixtures/run-state.mjs';
import { uniqueConversationId } from './fixtures/hook-payloads.mjs';
import { createModuleManifest } from './fixtures/sample-manifests.mjs';
import { spawnRunEngine } from './fixtures/run-engine-spawn.mjs';

describe('resume-run', () => {
  const runs = [];

  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it('resumes a failed run to running at current phase', async () => {
    const conversationId = uniqueConversationId('resume-failed');
    const runId = nextRunId('resume-failed');
    const manifest = createModuleManifest('impact_analysis', runId, conversationId);
    manifest.status = 'failed';
    manifest.blocked_reason = 'Phase mismatch: current=impact_analysis completed=validate';
    manifest.completed = ['discover', 'validate'];
    manifest.pending = ['dependency_graph', 'fitness_functions', 'report'];
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const result = await spawnRunEngine('resume-run.mjs', [runId, '--json']);
    expect(result.code).toBe(0);

    const lines = result.stdout.trim().split('\n');
    const payload = JSON.parse(lines[lines.length - 1]);
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('running');
    expect(payload.phase).toBe('impact_analysis');
    expect(payload.previous_status).toBe('failed');

    const updated = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
    expect(updated.status).toBe('running');
    expect(updated.blocked_reason).toBeNull();
  });

  it('resets current-phase swarm counters when resuming from failed', async () => {
    const conversationId = uniqueConversationId('resume-swarm-reset');
    const runId = nextRunId('resume-swarm-reset');
    const manifest = createModuleManifest('discover', runId, conversationId);
    manifest.status = 'failed';
    manifest.swarm = {
      task_launches_this_phase: 4,
      phase: 'discover',
      agents: [
        { index: 1, phase: 'discover', started_at: '2026-06-27T10:00:00.000Z' },
        { index: 2, phase: 'discover', started_at: '2026-06-27T10:00:01.000Z' },
        { index: 3, phase: 'discover', started_at: '2026-06-27T10:00:02.000Z' },
        { index: 4, phase: 'discover', started_at: '2026-06-27T10:00:03.000Z' },
      ],
    };
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const result = await spawnRunEngine('resume-run.mjs', [runId, '--json']);
    expect(result.code).toBe(0);

    const updated = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
    expect(updated.swarm.task_launches_this_phase).toBe(0);
    expect(updated.swarm.agents).toEqual([]);
    expect(updated.log.some((entry) => entry.event === 'resumed')).toBe(true);
  });
});
