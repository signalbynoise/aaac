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

  it('denies Write of test files during execute phase', async () => {
    const conversationId = uniqueConversationId('gate-execute-test');
    const runId = nextRunId('gate-execute-test');
    const manifest = createModuleManifest('execute', runId, conversationId);
    manifest.enforcement.edit_allowed = true;
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const testPath = `${REPO_ROOT}/packages/aaac/tests/foo.test.mjs`;
    const result = await gateWrite(preToolUseHook('Write', testPath, conversationId));

    expect(result.json?.permission).toBe('deny');
    expect(result.json?.agent_message).toMatch(/test_execute|scope/i);
  });

  it('allows Write of test files during test_execute phase', async () => {
    const conversationId = uniqueConversationId('gate-test-exec');
    const runId = nextRunId('gate-test-exec');
    const manifest = createModuleManifest('execute', runId, conversationId);
    manifest.phase = 'test_execute';
    manifest.enforcement.edit_allowed = true;
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const testPath = `${REPO_ROOT}/packages/aaac/tests/foo.test.mjs`;
    const result = await gateWrite(preToolUseHook('Write', testPath, conversationId));

    expect(result.json?.permission).toBe('allow');
  });

  it('denies Write of prod files during test_execute phase', async () => {
    const conversationId = uniqueConversationId('gate-test-exec-prod');
    const runId = nextRunId('gate-test-exec-prod');
    const manifest = createModuleManifest('execute', runId, conversationId);
    manifest.phase = 'test_execute';
    manifest.enforcement.edit_allowed = true;
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const appPath = `${REPO_ROOT}/apps/website/lib/nav/foo.ts`;
    const result = await gateWrite(preToolUseHook('Write', appPath, conversationId));

    expect(result.json?.permission).toBe('deny');
  });

  it('allows writes to run artifact paths during discover when swarm minimum met', async () => {
    const conversationId = uniqueConversationId('gate-artifact');
    const runId = nextRunId('gate-artifact');
    const manifest = createModuleManifest('discover', runId, conversationId);
    manifest.swarm = { task_launches_this_phase: 4, phase: 'discover', agents: [] };
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const artifactPath = artifactFilePath(runId, 'artifacts/discovery-brief.md');
    const result = await gateWrite(preToolUseHook('Write', artifactPath, conversationId));

    expect(result.json?.permission).toBe('allow');
  });

  it('denies decision artifact writes during validate without swarm', async () => {
    const conversationId = uniqueConversationId('gate-validate-swarm');
    const runId = nextRunId('gate-validate-swarm');
    const manifest = createModuleManifest('validate', runId, conversationId);
    manifest.phase = 'validate';
    manifest.phase_kind = 'gate';
    manifest.swarm = { task_launches_this_phase: 0, phase: 'validate', agents: [] };
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const artifactPath = artifactFilePath(runId, 'artifacts/validate.yaml');
    const result = await gateWrite(preToolUseHook('Write', artifactPath, conversationId));

    expect(result.json?.permission).toBe('deny');
    expect(result.json?.agent_message).toMatch(/agent separation|Task subagents/i);
  });

  it('allows decision artifact writes when swarm minimum met', async () => {
    const conversationId = uniqueConversationId('gate-validate-swarm-ok');
    const runId = nextRunId('gate-validate-swarm-ok');
    const manifest = createModuleManifest('validate', runId, conversationId);
    manifest.phase = 'validate';
    manifest.phase_kind = 'gate';
    manifest.swarm = { task_launches_this_phase: 3, phase: 'validate', agents: [] };
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const artifactPath = artifactFilePath(runId, 'artifacts/validate.yaml');
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

  it('denies parent prod Write during execute phase', async () => {
    const conversationId = uniqueConversationId('gate-execute-parent-deny');
    const runId = nextRunId('gate-execute-parent-deny');
    const manifest = createModuleManifest('execute', runId, conversationId);
    manifest.phase = 'execute';
    manifest.enforcement.edit_allowed = true;
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const appPath = `${REPO_ROOT}/apps/website/lib/nav/foo.ts`;
    const result = await gateWrite(preToolUseHook('Write', appPath, conversationId));

    expect(result.json?.permission).toBe('deny');
    expect(result.json?.agent_message).toMatch(/code-author|orchestrator cannot edit/i);
  });

  it('allows prod Write during execute when subagent_id is present', async () => {
    const conversationId = uniqueConversationId('gate-execute-subagent');
    const runId = nextRunId('gate-execute-subagent');
    const manifest = createModuleManifest('execute', runId, conversationId);
    manifest.phase = 'execute';
    manifest.enforcement.edit_allowed = true;
    manifest.swarm = {
      task_launches_this_phase: 1,
      phase: 'execute',
      agents: [],
      active_code_editors: [{ subagent_id: 'sub-abc', agent_spec_id: 'code-author', phase: 'execute' }],
    };
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const appPath = `${REPO_ROOT}/apps/website/lib/nav/foo.ts`;
    const hook = { ...preToolUseHook('Write', appPath, conversationId), subagent_id: 'sub-abc' };
    const result = await gateWrite(hook);

    expect(result.json?.permission).toBe('allow');
  });

  it('denies prod Write during execute when subagent_id present but active_code_editors empty', async () => {
    const conversationId = uniqueConversationId('gate-execute-unregistered-sub');
    const runId = nextRunId('gate-execute-unregistered-sub');
    const manifest = createModuleManifest('execute', runId, conversationId);
    manifest.phase = 'execute';
    manifest.enforcement.edit_allowed = true;
    manifest.swarm = {
      task_launches_this_phase: 1,
      phase: 'execute',
      agents: [],
      active_code_editors: [],
    };
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    const appPath = `${REPO_ROOT}/apps/website/lib/nav/foo.ts`;
    const hook = { ...preToolUseHook('Write', appPath, conversationId), subagent_id: 'sub-unregistered' };
    const result = await gateWrite(hook);

    expect(result.json?.permission).toBe('deny');
    expect(result.json?.agent_message).toMatch(/code-author|orchestrator cannot edit/i);
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
