import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  isRunStale,
  isTerminalRunStatus,
  markRunSuperseded,
  reconcileStaleRun,
  supersedeIncompleteRuns,
  syncRunSidecars,
} from '../src/run-engine/reconcile-run-status.mjs';
import { loadRunManifest } from '../src/run-engine/lib.mjs';
import {
  cleanupRun,
  conversationActivePath,
  nextRunId,
  seedRun,
} from './fixtures/run-state.mjs';
import { uniqueConversationId } from './fixtures/hook-payloads.mjs';

function makeManifest(runId, overrides = {}) {
  const now = new Date().toISOString();
  return {
    run_id: runId,
    conversation_id: uniqueConversationId('reconcile'),
    command: 'fix-app',
    verb: 'fix',
    status: 'running',
    phase: 'discover',
    phase_kind: 'work',
    created_at: now,
    updated_at: now,
    swarm: { task_launches_this_phase: 0 },
    enforcement: { edit_allowed: false },
    log: [],
    ...overrides,
  };
}

describe('reconcile-run-status', () => {
  const created = [];

  afterEach(() => {
    for (const { runId, conversationId } of created.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it('isTerminalRunStatus recognizes completed, failed, cancelled', () => {
    expect(isTerminalRunStatus('completed')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isTerminalRunStatus('cancelled')).toBe(true);
    expect(isTerminalRunStatus('running')).toBe(false);
  });

  it('isRunStale returns true when updated_at is older than threshold', () => {
    const stale = makeManifest(nextRunId('stale'), {
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    expect(isRunStale(stale, { staleMs: 60 * 60 * 1000 })).toBe(true);
  });

  it('reconcileStaleRun marks abandoned runs as failed', () => {
    const manifest = makeManifest(nextRunId('abandon'), {
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const result = reconcileStaleRun(manifest, { staleMs: 60 * 60 * 1000 });
    expect(result.changed).toBe(true);
    expect(result.manifest.status).toBe('failed');
    expect(result.manifest.blocked_reason).toMatch(/abandoned/i);
  });

  it('supersedeIncompleteRuns cancels prior incomplete run in same conversation', () => {
    const conversationId = uniqueConversationId('supersede');
    const oldRunId = nextRunId('old');
    const newRunId = nextRunId('new');
    const oldManifest = makeManifest(oldRunId, {
      conversation_id: conversationId,
      created_at: '2026-06-26T10:00:00.000Z',
      updated_at: '2026-06-26T10:01:00.000Z',
    });
    seedRun(oldManifest, conversationId);
    created.push({ runId: oldRunId, conversationId }, { runId: newRunId, conversationId });

    const superseded = supersedeIncompleteRuns({ conversationId, newRunId });
    expect(superseded).toEqual([oldRunId]);

    const updated = loadRunManifest(oldRunId);
    expect(updated.status).toBe('cancelled');
    expect(updated.blocked_reason).toContain(newRunId);
    expect(updated.completed_at).toBeTruthy();
    expect(typeof updated.metrics?.duration_ms).toBe('number');
    expect(updated.metrics.duration_ms).toBeGreaterThanOrEqual(0);
    expect(updated.metrics.token_source).toBeTruthy();
  });

  it('syncRunSidecars clears active-run when run completes', () => {
    const conversationId = uniqueConversationId('sidecar');
    const runId = nextRunId('done');
    const manifest = makeManifest(runId, {
      conversation_id: conversationId,
      status: 'completed',
      phase: 'report',
    });
    seedRun(manifest, conversationId);
    created.push({ runId, conversationId });

    syncRunSidecars(manifest);
    expect(fs.existsSync(conversationActivePath(conversationId))).toBe(false);
  });

  it('markRunSuperseded is idempotent for terminal runs', () => {
    const manifest = makeManifest(nextRunId('terminal'), { status: 'completed' });
    const result = markRunSuperseded(manifest, 'run_new');
    expect(result.status).toBe('completed');
  });
});
