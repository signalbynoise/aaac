import { describe, expect, it, afterEach } from 'vitest';
import { uniqueConversationId } from '../fixtures/hook-payloads.mjs';
import { cleanupRun, simulateVerbFlow } from './flow-helper.mjs';

describe('create-module verb flow', () => {
  let runId = null;
  let conversationId = null;

  afterEach(() => {
    if (runId && conversationId) {
      cleanupRun(runId, conversationId);
      runId = null;
      conversationId = null;
    }
  });

  it('runs init through completion with investigate_lite path', async () => {
    conversationId = uniqueConversationId('create-flow');
    const { runId: id, manifest } = await simulateVerbFlow(
      '/create-module ui "Integration test module"',
      conversationId,
    );
    runId = id;

    expect(manifest.status).toBe('completed');
    expect(manifest.verb).toBe('create');
    expect(manifest.object).toBe('module');
    expect(manifest.completed).toContain('discover');
    expect(manifest.completed).toContain('investigate_lite');
    expect(manifest.completed).not.toContain('investigate_swarm');
    expect(manifest.completed).toContain('execute');
    expect(manifest.enforcement.edit_allowed).toBe(false);
  });
});
