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

function manifestWithSwarmAgents(conversationId, runId) {
  const manifest = createModuleManifest('discover', runId, conversationId);
  manifest.swarm = {
    task_launches_this_phase: 2,
    phase: 'discover',
    agents: [
      {
        index: 1,
        phase: 'discover',
        subagent_id: 'sub-first',
        at: '2026-06-26T10:00:01.000Z',
        started_at: '2026-06-26T10:00:01.000Z',
      },
      {
        index: 2,
        phase: 'discover',
        subagent_id: 'sub-second',
        at: '2026-06-26T10:00:02.000Z',
        started_at: '2026-06-26T10:00:02.000Z',
      },
    ],
  };
  manifest.log = [];
  return manifest;
}

describe('record-subagent-progress', () => {
  const runs = [];

  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it('attributes progress with subagent_id to correct agent index in log', async () => {
    const conversationId = uniqueConversationId('subagent-progress');
    const runId = nextRunId('subagent-progress');
    seedRun(manifestWithSwarmAgents(conversationId, runId), conversationId);
    runs.push({ runId, conversationId });

    const result = await spawnRunEngine('record-subagent-progress.mjs', [], {
      conversation_id: conversationId,
      subagent_id: 'sub-second',
      tool_name: 'Read',
      tool_input: {
        path: 'packages/aaac/src/foo.ts',
        current_step: 'Reading foo module',
      },
    });

    expect(result.code).toBe(0);
    expect(result.json).toEqual({ permission: 'allow' });

    const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
    const progressEntries = manifest.log.filter((entry) => entry.event === 'agent_progress');
    expect(progressEntries).toHaveLength(1);
    expect(progressEntries[0].detail).toContain('agent_index=2');
    expect(progressEntries[0].phase).toBe('discover');
  });

  it('does not write agent_progress log entry without subagent_id', async () => {
    const conversationId = uniqueConversationId('subagent-progress-no-id');
    const runId = nextRunId('subagent-progress-no-id');
    seedRun(manifestWithSwarmAgents(conversationId, runId), conversationId);
    runs.push({ runId, conversationId });

    const result = await spawnRunEngine('record-subagent-progress.mjs', [], {
      conversation_id: conversationId,
      tool_name: 'Read',
      tool_input: {
        path: 'packages/aaac/src/foo.ts',
        current_step: 'Reading foo module',
      },
    });

    expect(result.code).toBe(0);
    expect(result.json).toEqual({ permission: 'allow' });

    const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
    const progressEntries = manifest.log.filter((entry) => entry.event === 'agent_progress');
    expect(progressEntries).toHaveLength(0);
  });
});
