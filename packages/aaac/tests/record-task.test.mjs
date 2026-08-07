import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  seedRun,
  cleanupRun,
  nextRunId,
  runManifestPath,
} from './fixtures/run-state.mjs';
import { subagentStartHook, uniqueConversationId } from './fixtures/hook-payloads.mjs';
import {
  createModuleManifest,
  withPhaseRoster,
} from './fixtures/sample-manifests.mjs';
import { spawnPackageRunEngine } from './fixtures/run-engine-spawn.mjs';

const runs = [];

/** Fresh timestamps so reconcile stale-run sweeper does not abandon fixtures mid-test. */
function withFreshClock(manifest) {
  const now = new Date().toISOString();
  return { ...manifest, created_at: now, updated_at: now };
}

/**
 * Spawn packages/aaac record-task (SSOT). Dual-tree .cursor mirror may lag
 * (e.g. missing resolve-model-for-phase.mjs) and would false-fail these tests.
 */
function recordTaskFromPackage(conversationId, hookOverrides = {}) {
  const payload = {
    ...subagentStartHook(conversationId),
    ...hookOverrides,
    conversation_id: conversationId,
  };
  return spawnPackageRunEngine('record-task.mjs', [], payload);
}

async function verifyOverflowLaunchGetsAgentSpecId() {
  const conversationId = uniqueConversationId('record-task-overflow');
  const runId = nextRunId('record-task-overflow');
  const seeded = withFreshClock(createModuleManifest('discover', runId, conversationId));
  seeded.swarm.task_launches_this_phase = 3;
  seeded.swarm.agents = seeded.swarm.expected_agent_specs.slice(0, 3).map(
    (spec, index) => ({
      index: index + 1,
      phase: 'discover',
      agent_spec_id: spec.id,
    }),
  );
  seedRun(seeded, conversationId);
  runs.push({ runId, conversationId });

  const result = await recordTaskFromPackage(conversationId, {
    description: null,
    readonly: true,
  });
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');

  const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
  expect(manifest.swarm.task_launches_this_phase).toBe(4);
  expect(manifest.swarm.agents).toHaveLength(4);
  const overflow = manifest.swarm.agents[3];
  expect(overflow.index).toBe(4);
  expect(overflow.agent_spec_id).toBeTruthy();
  expect(typeof overflow.agent_spec_id).toBe('string');
  expect(manifest.swarm.expected_agent_specs.length).toBeGreaterThanOrEqual(4);
  expect(manifest.swarm.expected_agent_specs[3]?.id).toBe(overflow.agent_spec_id);
}

describe('record-task', () => {
  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it('records per-sub-agent telemetry on swarm.agents', async () => {
    const conversationId = uniqueConversationId('record-task-telemetry');
    const runId = nextRunId('record-task-telemetry');
    seedRun(withFreshClock(createModuleManifest('discover', runId, conversationId)), conversationId);
    runs.push({ runId, conversationId });

    const result = await recordTaskFromPackage(conversationId, {
      description: 'discovery-inventory',
      readonly: true,
    });
    expect(result.code).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
    expect(manifest.swarm.task_launches_this_phase).toBe(1);
    expect(manifest.swarm.agents).toHaveLength(1);
    expect(manifest.swarm.agents[0].subagent_type).toBe('explore');
    expect(manifest.swarm.agents[0].description).toBe('discovery-inventory');
    expect(manifest.swarm.agents[0].agent_spec_id).toBe('discovery-inventory');
    expect(manifest.swarm.agents[0].readonly).toBe(true);
    expect(manifest.swarm.agents[0].initial_summary).toBeTruthy();
    expect(manifest.swarm.agents[0].last_progress).toBe(
      manifest.swarm.agents[0].initial_summary,
    );
    const spawn = manifest.log.find((entry) => entry.event === 'agent_spawned');
    expect(JSON.parse(spawn.detail).initial_summary).toBe(
      manifest.swarm.agents[0].initial_summary,
    );
    expect(manifest.log.some((entry) => entry.event === 'agent_progress')).toBe(false);
  });
});

async function verifyExpectedSpecSlotFill() {
  const conversationId = uniqueConversationId('record-task-slot-fill');
  const runId = nextRunId('record-task-slot-fill');
  const seeded = withFreshClock(createModuleManifest('discover', runId, conversationId));
  seedRun(seeded, conversationId);
  runs.push({ runId, conversationId });

  const result = await recordTaskFromPackage(conversationId, {
    description: null,
    readonly: true,
  });
  expect(result.code).toBe(0);

  const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
  expect(manifest.swarm.task_launches_this_phase).toBe(1);
  expect(manifest.swarm.agents).toHaveLength(1);
  expect(manifest.swarm.agents[0].description).toBeNull();
  expect(manifest.swarm.agents[0].agent_spec_id).toBe('discovery-inventory');
}

async function verifyMismatchedExplicitAgentIdRejection() {
  const conversationId = uniqueConversationId('record-task-wrong-explicit');
  const runId = nextRunId('record-task-wrong-explicit');
  seedRun(
    withFreshClock(createModuleManifest('discover', runId, conversationId)),
    conversationId,
  );
  runs.push({ runId, conversationId });

  const result = await recordTaskFromPackage(conversationId, {
    agent_spec_id: 'discovery-boundaries',
    readonly: true,
  });
  expect(result.code).toBe(0);
  expect(result.stderr).toMatch(
    /Explicit agent spec discovery-boundaries does not match discover slot 1/,
  );

  const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
  expect(manifest.swarm.task_launches_this_phase).toBe(0);
  expect(manifest.swarm.agents ?? []).toHaveLength(0);
}

async function verifyMatchingExplicitAgentIdAcceptance() {
  const conversationId = uniqueConversationId('record-task-matching-explicit');
  const runId = nextRunId('record-task-matching-explicit');
  seedRun(
    withFreshClock(createModuleManifest('discover', runId, conversationId)),
    conversationId,
  );
  runs.push({ runId, conversationId });

  const result = await recordTaskFromPackage(conversationId, {
    agent_spec_id: 'discovery-inventory',
    readonly: true,
  });
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');

  const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
  expect(manifest.swarm.agents[0]).toMatchObject({
    phase: 'discover',
    agent_spec_id: 'discovery-inventory',
    agent_spec_path: '.cursor/agents/discovery-inventory.md',
  });
}

async function launchConfiguredCodeAuthorWaves(conversationId) {
  const result = await recordTaskFromPackage(conversationId, {
    description: 'Implement the approved production changes',
    agent_spec_id: 'code-author',
    readonly: false,
  });
  const waveResult = await recordTaskFromPackage(conversationId, {
    description: 'Implement the approved production changes in the next wave',
    agent_spec_id: 'code-author',
    readonly: false,
  });
  return { result, waveResult };
}

async function verifyRequiredExecuteCodeAuthorPath() {
  const conversationId = uniqueConversationId('record-task-explicit-code-author');
  const runId = nextRunId('record-task-explicit-code-author');
  const seeded = withFreshClock(createModuleManifest('execute', runId, conversationId));
  withPhaseRoster(seeded, 'execute', 2);
  seedRun(seeded, conversationId);
  runs.push({ runId, conversationId });

  const { result, waveResult } = await launchConfiguredCodeAuthorWaves(conversationId);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  expect(waveResult.code).toBe(0);
  expect(waveResult.stderr).toBe('');

  const manifest = JSON.parse(fs.readFileSync(runManifestPath(runId), 'utf8'));
  expect(manifest.swarm.agents).toHaveLength(2);
  expect(manifest.swarm.agents[0]).toMatchObject({
    phase: 'execute',
    agent_spec_id: 'code-author',
    agent_spec_path: '.cursor/agents/code-author.md',
  });
  expect(manifest.swarm.agents[1]).toMatchObject({
    phase: 'execute',
    agent_spec_id: 'code-author-wave-1',
    agent_spec_path: '.cursor/agents/code-author.md',
  });
  expect(manifest.swarm.agents[0].initial_summary).toBeTruthy();
  expect(manifest.swarm.agents[0].last_progress).toBe(
    manifest.swarm.agents[0].initial_summary,
  );
}

describe('record-task', () => {
  it('slot-fills agent_spec_id from expected specs when description is null', verifyExpectedSpecSlotFill);
  it('rejects an explicit agent ID that does not match the current slot', verifyMismatchedExplicitAgentIdRejection);
  it('accepts an explicit agent ID that matches the current slot', verifyMatchingExplicitAgentIdAcceptance);
});

describe('record-task', () => {
  it('accepts the required execute code-author path across configured waves', verifyRequiredExecuteCodeAuthorPath);
});

describe('record-task', () => {
  it('overflow launchIndex > expected_agent_specs.length still gets agent_spec_id', verifyOverflowLaunchGetsAgentSpecId);
});
