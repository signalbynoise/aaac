import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  seedRun,
  cleanupRun,
  nextRunId,
  runManifestPath,
} from './fixtures/run-state.mjs';
import { subagentStartHook, uniqueConversationId } from './fixtures/hook-payloads.mjs';
import { recordTaskLaunch } from './fixtures/run-engine-spawn.mjs';
import { createModuleManifest } from './fixtures/sample-manifests.mjs';

describe('record-task', () => {
  const runs = [];

  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it('records per-sub-agent telemetry on swarm.agents', async () => {
    const conversationId = uniqueConversationId('record-task-telemetry');
    const runId = nextRunId('record-task-telemetry');
    seedRun(createModuleManifest('discover', runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    const hook = {
      ...subagentStartHook(conversationId),
      description: 'discovery-inventory',
      readonly: true,
    };
    await recordTaskLaunch(conversationId, hook);

    const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
    expect(manifest.swarm.task_launches_this_phase).toBe(1);
    expect(manifest.swarm.agents).toHaveLength(1);
    expect(manifest.swarm.agents[0].subagent_type).toBe('explore');
    expect(manifest.swarm.agents[0].description).toBe('discovery-inventory');
    expect(manifest.swarm.agents[0].readonly).toBe(true);
  });
});
