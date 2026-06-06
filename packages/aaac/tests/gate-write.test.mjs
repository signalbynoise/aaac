import { describe, expect, it, afterEach } from 'vitest';
import { REPO_ROOT } from './fixtures/paths.mjs';
import { preToolUseHook, uniqueConversationId } from './fixtures/hook-payloads.mjs';
import {
  seedRun,
  cleanupRun,
  artifactFilePath,
  nextRunId,
} from './fixtures/run-state.mjs';
import { checkModuleManifest, createModuleManifest } from './fixtures/sample-manifests.mjs';
import { gateWrite } from './fixtures/run-engine-spawn.mjs';

describe('gate-write', () => {
  const runs = [];

  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it('denies Write during discover phase for app source paths', async () => {
    const conversationId = uniqueConversationId('gate-discover');
    const runId = nextRunId('gate-discover');
    seedRun(createModuleManifest('discover', runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    const appPath = `${REPO_ROOT}/apps/website/lib/nav/foo.ts`;
    const result = await gateWrite(preToolUseHook('Write', appPath, conversationId));

    expect(result.json?.permission).toBe('deny');
    expect(result.json?.agent_message).toMatch(/discover/i);
  });

  it('allows Write during execute phase', async () => {
    const conversationId = uniqueConversationId('gate-execute');
    const runId = nextRunId('gate-execute');
    const manifest = createModuleManifest('execute', runId, conversationId);
    manifest.enforcement.edit_allowed = true;
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const appPath = `${REPO_ROOT}/apps/website/lib/nav/foo.ts`;
    const result = await gateWrite(preToolUseHook('Write', appPath, conversationId));

    expect(result.json?.permission).toBe('allow');
  });

  it('allows writes to run artifact paths during discover', async () => {
    const conversationId = uniqueConversationId('gate-artifact');
    const runId = nextRunId('gate-artifact');
    seedRun(createModuleManifest('discover', runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    const artifactPath = artifactFilePath(runId, 'artifacts/discovery-brief.md');
    const result = await gateWrite(preToolUseHook('Write', artifactPath, conversationId));

    expect(result.json?.permission).toBe('allow');
  });

  it('denies Write during validate phase for check verb (no execute phase)', async () => {
    const conversationId = uniqueConversationId('gate-check');
    const runId = nextRunId('gate-check');
    const manifest = checkModuleManifest('validate', runId, conversationId);
    manifest.enforcement.edit_allowed = false;
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const appPath = `${REPO_ROOT}/apps/website/lib/nav/foo.ts`;
    const result = await gateWrite(preToolUseHook('Write', appPath, conversationId));

    expect(result.json?.permission).toBe('deny');
    expect(result.json?.agent_message).toMatch(/validate/i);
  });

  it('allows non-edit tools without checking phase', async () => {
    const conversationId = uniqueConversationId('gate-read');
    const runId = nextRunId('gate-read');
    seedRun(createModuleManifest('discover', runId, conversationId), conversationId);
    runs.push({ runId, conversationId });

    const result = await gateWrite(
      preToolUseHook('Read', `${REPO_ROOT}/apps/website/package.json`, conversationId),
    );

    expect(result.json?.permission).toBe('allow');
  });
});
