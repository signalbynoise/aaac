import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  hasYamlField,
  planRequiresTests,
  readYamlListField,
  validatePhaseArtifactContent,
  validateExecuteAgentSpec,
  normalizePhaseArtifactPath,
  runDir,
} from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import { writeArtifact, nextRunId, seedRun, cleanupRun } from './fixtures/run-state.mjs';
import { createModuleManifest } from './fixtures/sample-manifests.mjs';
import { loadEnforcement } from '../../../.cursor/aaac/scripts/run-engine/lib.mjs';
import { uniqueConversationId } from './fixtures/hook-payloads.mjs';

describe('artifact content gates', () => {
  const runs = [];

  afterEach(() => {
    for (const { runId, conversationId } of runs.splice(0)) {
      cleanupRun(runId, conversationId);
    }
  });

  it('readYamlListField parses list items', () => {
    const yaml = 'tests_to_add:\n  - behavior: one\n  - behavior: two\nsteps: []\n';
    expect(readYamlListField(yaml, 'tests_to_add')).toEqual(['behavior: one', 'behavior: two']);
  });

  it('planRequiresTests is true when tests_to_add has entries', () => {
    const yaml = 'tests_to_add:\n  - behavior: cache hit\n';
    expect(planRequiresTests(yaml)).toBe(true);
  });

  it('validatePhaseArtifactContent rejects deferred test_plan', () => {
    const conversationId = uniqueConversationId('artifact-gate');
    const runId = nextRunId('artifact-gate');
    const manifest = createModuleManifest('test_execute', runId, conversationId);
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    writeArtifact(
      runId,
      'artifacts/plan.yaml',
      'tests_to_add:\n  - behavior: required\n',
    );
    writeArtifact(
      runId,
      'artifacts/test_plan.yaml',
      'status: deferred\n',
    );

    const enforcement = loadEnforcement();
    const result = validatePhaseArtifactContent(
      runId,
      'test_execute',
      manifest,
      enforcement,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/defer/i);
  });

  it('validateExecuteAgentSpec passes when execute agent has code-author spec', () => {
    const enforcement = loadEnforcement();
    const manifest = createModuleManifest('execute', nextRunId('exec-spec-ok'));
    manifest.swarm = {
      agents: [{ phase: 'execute', agent_spec_id: 'code-author' }],
    };
    const result = validateExecuteAgentSpec(manifest, enforcement, 'execute');
    expect(result.ok).toBe(true);
  });

  it('validateExecuteAgentSpec rejects wrong or missing agent_spec_id', () => {
    const enforcement = loadEnforcement();
    const manifest = createModuleManifest('execute', nextRunId('exec-spec-fail'));
    manifest.swarm = {
      agents: [{ phase: 'execute', agent_spec_id: 'explorer' }],
    };
    const wrong = validateExecuteAgentSpec(manifest, enforcement, 'execute');
    expect(wrong.ok).toBe(false);
    expect(wrong.reason).toMatch(/code-author/);

    const none = validateExecuteAgentSpec(
      { ...manifest, swarm: { agents: [] } },
      enforcement,
      'execute',
    );
    expect(none.ok).toBe(false);
    expect(none.reason).toMatch(/found: \(none\)/);
  });

  it('normalizePhaseArtifactPath renames impact_analysis.yaml to impact.yaml', () => {
    const conversationId = uniqueConversationId('artifact-alias');
    const runId = nextRunId('artifact-alias');
    const manifest = createModuleManifest('impact_analysis', runId, conversationId);
    seedRun(manifest, conversationId);
    runs.push({ runId, conversationId });

    writeArtifact(
      runId,
      'artifacts/impact_analysis.yaml',
      'blast_radius: low\nproceed: yes\n',
    );

    const enforcement = loadEnforcement();
    const result = normalizePhaseArtifactPath(
      runId,
      'artifacts/impact.yaml',
      enforcement,
    );
    expect(result.ok).toBe(true);
    expect(result.normalized_from).toBe('artifacts/impact_analysis.yaml');
    expect(fs.existsSync(path.join(runDir(runId), 'artifacts/impact.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(runDir(runId), 'artifacts/impact_analysis.yaml'))).toBe(
      false,
    );
  });
});
