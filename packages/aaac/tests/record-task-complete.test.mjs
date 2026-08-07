import { describe, expect, it, afterEach } from 'vitest';
import { nextRunId } from './fixtures/run-state.mjs';
import { uniqueConversationId } from './fixtures/hook-payloads.mjs';
import {
  createAgentProgressLock,
  seedTrackedAgentRun,
  cleanupTrackedAgentRuns,
  callAgentHookAndReadManifest,
} from './fixtures/agent-progress-run.mjs';

const runs = [];

describe('record-task-complete', () => {
  afterEach(() => {
    cleanupTrackedAgentRuns(runs);
  });

  it('subagentStop seal sets completed_at for matching subagentId', async () => {
    const conversationId = uniqueConversationId('task-complete-seal');
    const runId = nextRunId('task-complete-seal');
    seedTrackedAgentRun({ conversationId, runId, runs });

    const outcome = await callAgentHookAndReadManifest(
      'record-task-complete.mjs',
      runId,
      {
        conversation_id: conversationId,
        subagent_id: 'sub-second',
        final_summary: 'Finished second discover agent.',
      },
    );
    const { result, manifest } = outcome;

    expect(result.code).toBe(0);
    expect(result.json).toEqual({ permission: 'allow' });

    expect(manifest.swarm.agents[0].completed_at).toBeFalsy();
    expect(manifest.swarm.agents[1].completed_at).toBeTruthy();
    expect(manifest.swarm.agents[1].subagent_id).toBe('sub-second');
    expect(manifest.swarm.agents[1].summary).toBe('Finished second discover agent.');
  });
});

describe('record-task-complete', () => {

  it('without Cursor tokens seals unavailable meters — never chars/4 invent', async () => {
    const conversationId = uniqueConversationId('task-complete-unmetered');
    const runId = nextRunId('task-complete-unmetered');
    seedTrackedAgentRun({
      conversationId,
      runId,
      runs,
      mutate: (manifest) => {
        manifest.metrics = {
          conversation_tokens: 42_000,
          context_usage_percent: 33.5,
        };
      },
    });

    const longOutput =
      'Completed explore pass over packages/ui/src/agentic-os/phase-timeline.ts and related helpers with no Cursor meters';
    const inventEstimate = Math.max(1, Math.round(longOutput.length / 4));

    const outcome = await callAgentHookAndReadManifest(
      'record-task-complete.mjs',
      runId,
      {
        conversation_id: conversationId,
        subagent_id: 'sub-first',
        result: longOutput,
        final_summary: 'Sealed without inventing token meters.',
      },
    );
    const { result, manifest } = outcome;

    expect(result.code).toBe(0);
    expect(result.json).toEqual({ permission: 'allow' });

    const agent = manifest.swarm.agents[0];
    expect(agent.completed_at).toBeTruthy();
    expect(agent.tokens).toBeNull();
    expect(agent.context).toBeNull();
    expect(agent.token_source).toBe('unavailable');
    expect(agent.tokens).not.toBe(inventEstimate);
    expect(manifest.metrics.conversation_tokens).toBe(42_000);
  });
});

describe('record-task-complete', () => {

  it('Cursor-provided tokens seal as metered cursor_hook', async () => {
    const conversationId = uniqueConversationId('task-complete-metered');
    const runId = nextRunId('task-complete-metered');
    seedTrackedAgentRun({ conversationId, runId, runs });

    const outcome = await callAgentHookAndReadManifest(
      'record-task-complete.mjs',
      runId,
      {
        conversation_id: conversationId,
        subagent_id: 'sub-first',
        tokens: 1200,
        context: 4.5,
        final_summary: 'Sealed with Cursor meters.',
      },
    );
    const { result, manifest } = outcome;

    expect(result.code).toBe(0);

    const agent = manifest.swarm.agents[0];
    expect(agent.completed_at).toBeTruthy();
    expect(agent.tokens).toBe(1200);
    expect(agent.context).toBe(4.5);
    expect(agent.token_source).toBe('cursor_hook');
  });

  it('normalizes subagent_id with embedded newlines for seal match', async () => {
    const conversationId = uniqueConversationId('task-complete-normalize');
    const runId = nextRunId('task-complete-normalize');
    seedTrackedAgentRun({ conversationId, runId, runs });

    const outcome = await callAgentHookAndReadManifest(
      'record-task-complete.mjs',
      runId,
      {
        conversation_id: conversationId,
        subagent_id: 'sub-second\n',
        final_summary: 'Matched after normalize.',
      },
    );
    const { result, manifest } = outcome;

    expect(result.code).toBe(0);

    expect(manifest.swarm.agents[1].completed_at).toBeTruthy();
    expect(manifest.swarm.agents[0].completed_at).toBeFalsy();
  });
});

describe('record-task-complete', () => {

  it('invalid completion output falls back to last validated semantic summary', async () => {
    const conversationId = uniqueConversationId('task-complete-semantic-fallback');
    const runId = nextRunId('task-complete-semantic-fallback');
    seedTrackedAgentRun({
      conversationId,
      runId,
      runs,
      mutate: (manifest) => {
        manifest.swarm.agents[0].last_progress = 'Checking completion behavior';
      },
    });

    const outcome = await callAgentHookAndReadManifest(
      'record-task-complete.mjs',
      runId,
      {
        conversation_id: conversationId,
        subagent_id: 'sub-first',
        result: 'stdout=/Users/example/private-output tokens=500',
        final_summary: 'tokens=500 context=2',
        tokens: 500,
        context: 2,
      },
    );
    const { result, manifest } = outcome;

    expect(result.code).toBe(0);
    const agent = manifest.swarm.agents[0];
    expect(agent.summary).toBe('Checking completion behavior');
    expect(agent.summary).not.toMatch(/tokens=|stdout=|\/Users\//);
    expect(agent.tokens).toBe(500);
    expect(agent.context).toBe(2);
  });

  it('logs manifest lock failure and fails open without sealing completion', async () => {
    const conversationId = uniqueConversationId('task-complete-lock-failure');
    const runId = nextRunId('task-complete-lock-failure');
    seedTrackedAgentRun({ conversationId, runId, runs });
    createAgentProgressLock(runId);

    const outcome = await callAgentHookAndReadManifest(
      'record-task-complete.mjs',
      runId,
      {
        conversation_id: conversationId,
        subagent_id: 'sub-first',
        final_summary: 'Completion that cannot be persisted while locked.',
      },
    );
    const { result, manifest } = outcome;

    expect(result.code).toBe(0);
    expect(result.json).toEqual({ permission: 'allow' });
    expect(result.stderr).toContain('"operation":"record-task-complete"');
    expect(result.stderr).toContain('Failed to seal subagent completion; allowing hook');
    expect(result.stderr).toMatch(/Timed out acquiring agent progress lock/);

    expect(manifest.swarm.agents[0].completed_at).toBeUndefined();
    expect(manifest.swarm.agents[0].summary).toBeUndefined();
  });
});
