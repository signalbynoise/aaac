import { describe, expect, it, afterEach } from 'vitest';
import { nextRunId } from './fixtures/run-state.mjs';
import { uniqueConversationId } from './fixtures/hook-payloads.mjs';
import {
  callAgentHookAndReadManifest,
  cleanupTrackedAgentRuns,
  createAgentProgressLock,
  seedTrackedAgentRun,
} from './fixtures/agent-progress-run.mjs';
import { formatAgentMetricsDetail } from '../src/run-engine/swarm-telemetry.mjs';

const runs = [];

describe('record-subagent-progress', () => {
  afterEach(() => cleanupTrackedAgentRuns(runs));

  it('progress_appends_partial_metrics: tokens= when context is null', () => {
    const detail = formatAgentMetricsDetail({ tokens: 42_000, context: null });
    expect(detail).toBe('tokens=42000');
    expect(detail).toContain('tokens=');
    expect(detail).not.toContain('context=');
  });

  it('progress_appends_partial_metrics: context= when tokens is null', () => {
    const detail = formatAgentMetricsDetail({ tokens: null, context: 12.5 });
    expect(detail).toBe('context=12.50');
    expect(detail).toContain('context=');
    expect(detail).not.toContain('tokens=');
  });

  it('attributes progress with subagent_id to correct agent index in log', async () => {
    const conversationId = uniqueConversationId('subagent-progress');
    const runId = nextRunId('subagent-progress');
    seedTrackedAgentRun({ conversationId, runId, runs });

    const { result, manifest } = await callAgentHookAndReadManifest(
      'record-subagent-progress.mjs',
      runId,
      {
      conversation_id: conversationId,
      subagent_id: 'sub-second',
      tool_name: 'UpdateCurrentStep',
      tool_input: {
        current_step: 'Reviewing progress attribution',
      },
      },
    );

    expect(result.code).toBe(0);
    expect(result.json).toEqual({ permission: 'allow' });

    const progressEntries = manifest.log.filter((entry) => entry.event === 'agent_progress');
    expect(progressEntries).toHaveLength(1);
    expect(JSON.parse(progressEntries[0].detail)).toEqual({
      agent_index: 2,
      semantic_summary: 'Reviewing progress attribution',
    });
    expect(progressEntries[0].phase).toBe('discover');
    expect(manifest.swarm.agents[1].last_progress).toBe(
      'Reviewing progress attribution',
    );
  });
});

describe('record-subagent-progress', () => {

  it('does not write agent_progress log entry without subagent_id', async () => {
    const conversationId = uniqueConversationId('subagent-progress-no-id');
    const runId = nextRunId('subagent-progress-no-id');
    seedTrackedAgentRun({ conversationId, runId, runs });

    const { result, manifest } = await callAgentHookAndReadManifest(
      'record-subagent-progress.mjs',
      runId,
      {
      conversation_id: conversationId,
      tool_name: 'UpdateCurrentStep',
      tool_input: {
        current_step: 'Reviewing progress attribution',
      },
      },
    );

    expect(result.code).toBe(0);
    expect(result.json).toEqual({ permission: 'allow' });

    const progressEntries = manifest.log.filter((entry) => entry.event === 'agent_progress');
    expect(progressEntries).toHaveLength(0);
    expect(manifest.swarm.agents.every((agent) => agent.last_progress == null)).toBe(true);
  });
});

describe('record-subagent-progress', () => {

  it('progress_does_not_stamp_conversation_tokens_on_agent_progress', async () => {
    const conversationId = uniqueConversationId('subagent-progress-no-stamp');
    const runId = nextRunId('subagent-progress-no-stamp');
    seedTrackedAgentRun({
      conversationId,
      runId,
      runs,
      mutate: (manifest) => {
        manifest.metrics = {
          ...(manifest.metrics ?? {}),
          conversation_tokens: 42_000,
          context_usage_percent: 33.5,
        };
      },
    });

    const { result, manifest } = await callAgentHookAndReadManifest(
      'record-subagent-progress.mjs',
      runId,
      {
      conversation_id: conversationId,
      subagent_id: 'sub-first',
      tool_name: 'UpdateCurrentStep',
      tool_input: {
        current_step: 'Reviewing semantic metrics',
      },
      },
    );

    expect(result.code).toBe(0);
    expect(result.json).toEqual({ permission: 'allow' });

    const progressEntries = manifest.log.filter((entry) => entry.event === 'agent_progress');
    expect(progressEntries).toHaveLength(1);
    const detail = progressEntries[0].detail ?? '';
    expect(JSON.parse(detail)).toEqual({
      agent_index: 1,
      semantic_summary: 'Reviewing semantic metrics',
    });
    expect(detail).not.toContain('tokens=');
    expect(detail).not.toContain('context=');
    expect(detail).not.toContain('42000');
    expect(detail).not.toContain('33.5');
  });
});

describe('record-subagent-progress', () => {

  it('ordinary tools meter files but never replace semantic progress', async () => {
    const conversationId = uniqueConversationId('subagent-progress-ordinary-tool');
    const runId = nextRunId('subagent-progress-ordinary-tool');
    seedTrackedAgentRun({
      conversationId,
      runId,
      runs,
      mutate: (manifest) => {
        manifest.swarm.agents[0].last_progress = 'Reviewing assigned behavior';
      },
    });

    const { result, manifest } = await callAgentHookAndReadManifest(
      'record-subagent-progress.mjs',
      runId,
      {
      conversation_id: conversationId,
      subagent_id: 'sub-first',
      tool_name: 'Read',
      tool_input: {
        path: '/Users/example/private-module.ts',
        current_step: 'This field has no semantic provenance',
      },
      },
    );

    expect(result.code).toBe(0);
    expect(manifest.swarm.agents[0].files_read).toBe(1);
    expect(manifest.swarm.agents[0].last_progress).toBe('Reviewing assigned behavior');
    expect(manifest.log.filter((entry) => entry.event === 'agent_progress')).toHaveLength(0);
  });

  it('logs manifest lock failure and fails open with allow permission', async () => {
    const conversationId = uniqueConversationId('subagent-progress-lock-failure');
    const runId = nextRunId('subagent-progress-lock-failure');
    seedTrackedAgentRun({ conversationId, runId, runs });
    createAgentProgressLock(runId);

    const { result, manifest } = await callAgentHookAndReadManifest(
      'record-subagent-progress.mjs',
      runId,
      {
      conversation_id: conversationId,
      subagent_id: 'sub-first',
      tool_name: 'UpdateCurrentStep',
      tool_input: {
        current_step: 'Reviewing lock failure behavior',
      },
      },
    );

    expect(result.code).toBe(0);
    expect(result.json).toEqual({ permission: 'allow' });
    expect(result.stderr).toContain('"operation":"record-subagent-progress"');
    expect(result.stderr).toContain('Failed to record subagent progress; allowing hook');
    expect(result.stderr).toMatch(/Timed out acquiring agent progress lock/);

    expect(manifest.swarm.agents[0].last_progress).toBeUndefined();
    expect(manifest.log.filter((entry) => entry.event === 'agent_progress')).toHaveLength(0);
  });
});