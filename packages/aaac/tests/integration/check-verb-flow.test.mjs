import { describe, expect, it, afterEach } from 'vitest';
import { loadRegistry } from '../../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import { uniqueConversationId } from '../fixtures/hook-payloads.mjs';
import { cleanupRun, simulateVerbFlow } from './flow-helper.mjs';

describe('check-module verb flow', () => {
  let runId = null;
  let conversationId = null;

  afterEach(() => {
    if (runId && conversationId) {
      cleanupRun(runId, conversationId);
      runId = null;
      conversationId = null;
    }
  });

  it('runs init through completion without execute — readonly check path', async () => {
    conversationId = uniqueConversationId('check-flow');
    const { runId: id, manifest } = await simulateVerbFlow(
      '/check-module ui "Can nav persist state?"',
      conversationId,
    );
    runId = id;

    const registry = loadRegistry();
    const expectedPending = registry.commands['check-module'].pending;

    expect(manifest.status).toBe('completed');
    expect(manifest.verb).toBe('check');
    expect(manifest.object).toBe('module');
    expect(manifest.completed).toEqual(expectedPending);
    expect(manifest.completed).toContain('discover');
    expect(manifest.completed).toContain('validate');
    expect(manifest.completed).not.toContain('execute');
    expect(manifest.completed).not.toContain('plan');
    expect(manifest.completed).not.toContain('investigate_lite');
    expect(manifest.enforcement.edit_allowed).toBe(false);
  });
});
