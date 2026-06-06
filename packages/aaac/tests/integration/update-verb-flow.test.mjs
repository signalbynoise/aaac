import { describe, expect, it, afterEach } from 'vitest';
import { uniqueConversationId } from '../fixtures/hook-payloads.mjs';
import { cleanupRun, simulateVerbFlow } from './flow-helper.mjs';

describe('update-module verb flow', () => {
  let runId = null;
  let conversationId = null;

  afterEach(() => {
    if (runId && conversationId) {
      cleanupRun(runId, conversationId);
      runId = null;
      conversationId = null;
    }
  });

  it('runs init through completion with update verb pending', async () => {
    conversationId = uniqueConversationId('update-flow');
    const { runId: id, manifest } = await simulateVerbFlow(
      '/update-module cms "Refresh orchestrator contract"',
      conversationId,
    );
    runId = id;

    expect(manifest.status).toBe('completed');
    expect(manifest.verb).toBe('update');
    expect(manifest.command).toBe('update-module');
    expect(manifest.completed).toEqual(
      expect.arrayContaining([
        'discover',
        'investigate_lite',
        'plan',
        'execute',
        'verify',
        'report',
      ]),
    );
    expect(manifest.completed).not.toContain('root_cause');
  });
});
