/**
 * V5 graph learning + hash-gated artifact reuse.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const EXP = path.join(PACKAGE_ROOT, 'src/run-engine/experience');

async function load(name) {
  return import(pathToFileURL(path.join(EXP, name)).href);
}

describe('V5 graph policy', () => {
  it('steps down after 3 quality-ok runs and never below safety', async () => {
    const {
      emptyGraphPolicyStore,
      updateGraphPolicyFromTrajectory,
      selectGraphTargets,
      STREAK_TO_STEP,
      SAFETY_FLOORS,
    } = await load('graph-policy.mjs');

    const store = emptyGraphPolicyStore();
    const manifest = {
      verb: 'review',
      object: 'module',
      domain: 'system',
      command: 'review-module',
    };
    const okTraj = { quality: { ok: true } };

    for (let i = 0; i < STREAK_TO_STEP - 1; i += 1) {
      const r = updateGraphPolicyFromTrajectory(store, okTraj, manifest);
      expect(r.stepped_down).toEqual([]);
    }
    const stepped = updateGraphPolicyFromTrajectory(store, okTraj, manifest);
    expect(stepped.stepped_down).toContain('discover');
    expect(selectGraphTargets(manifest, store).discover).toBe(3);

    for (let i = 0; i < 10; i += 1) {
      for (let j = 0; j < STREAK_TO_STEP; j += 1) {
        updateGraphPolicyFromTrajectory(store, okTraj, manifest);
      }
    }
    expect(selectGraphTargets(manifest, store).discover).toBe(
      SAFETY_FLOORS.discover,
    );
    expect(selectGraphTargets(manifest, store).plan).toBe(SAFETY_FLOORS.plan);
  });

  it('bumps targets up on quality fail', async () => {
    const {
      emptyGraphPolicyStore,
      updateGraphPolicyFromTrajectory,
      selectGraphTargets,
      STREAK_TO_STEP,
    } = await load('graph-policy.mjs');

    const store = emptyGraphPolicyStore();
    const manifest = {
      verb: 'review',
      object: 'module',
      domain: 'system',
    };
    for (let i = 0; i < STREAK_TO_STEP; i += 1) {
      updateGraphPolicyFromTrajectory(
        store,
        { quality: { ok: true } },
        manifest,
      );
    }
    expect(selectGraphTargets(manifest, store).discover).toBe(3);

    const up = updateGraphPolicyFromTrajectory(
      store,
      { quality: { ok: false } },
      manifest,
    );
    expect(up.stepped_up).toContain('discover');
    expect(selectGraphTargets(manifest, store).discover).toBe(4);
  });

  it('does not update mutating verbs', async () => {
    const { emptyGraphPolicyStore, updateGraphPolicyFromTrajectory } =
      await load('graph-policy.mjs');
    const store = emptyGraphPolicyStore();
    const r = updateGraphPolicyFromTrajectory(
      store,
      { quality: { ok: true } },
      { verb: 'update', object: 'module', domain: 'system' },
    );
    expect(r.stepped_down).toEqual([]);
    expect(Object.keys(store.signatures)).toHaveLength(0);
  });

  it('clampLearnedTarget respects safety and yaml floor', async () => {
    const { clampLearnedTarget } = await load('graph-policy.mjs');
    expect(clampLearnedTarget(3, 2, 4)).toBe(3);
    expect(clampLearnedTarget(1, 2, 4)).toBe(2);
    expect(clampLearnedTarget(9, 2, 4)).toBe(4);
  });
});

describe('V5 artifact reuse', () => {
  let tmp;
  const prevRoot = process.env.AAAC_WORKSPACE_ROOT;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-v5-reuse-'));
    fs.mkdirSync(path.join(tmp, '.cursor/aaac/state'), { recursive: true });
    const scoped = path.join(tmp, 'apps/agentic-os/src/shared/domain/bandit.ts');
    fs.mkdirSync(path.dirname(scoped), { recursive: true });
    fs.writeFileSync(scoped, 'export const x = 1;\n');
    process.env.AAAC_WORKSPACE_ROOT = tmp;
  });

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.AAAC_WORKSPACE_ROOT;
    else process.env.AAAC_WORKSPACE_ROOT = prevRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('caches on quality-ok and injects when fingerprints match', async () => {
    const mod = await import(
      `${pathToFileURL(path.join(EXP, 'artifact-reuse.mjs')).href}?t=${Date.now()}`
    );

    const manifest = {
      verb: 'review',
      object: 'module',
      domain: 'system',
      command: 'review-module',
      intent:
        'Review only apps/agentic-os/src/shared/domain/bandit.ts — keep plan short',
    };

    const artifactsDir = path.join(tmp, 'run-artifacts');
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, 'plan.yaml'), 'goal: test\n');
    fs.writeFileSync(path.join(artifactsDir, 'report.md'), '# ok\n');

    const cached = mod.cacheArtifactsFromRun(manifest, artifactsDir, {
      repoRoot: tmp,
      qualityOk: true,
    });
    expect(cached.cached).toBe(true);

    const selected = mod.selectPriorArtifacts(manifest, { repoRoot: tmp });
    expect(selected.reuse_mode).toBe('delta_or_confirm');
    expect(selected.prior_artifacts?.files?.['plan.yaml']).toContain('goal:');
    expect(selected.reuse_hits).toBe(1);

    fs.writeFileSync(
      path.join(tmp, 'apps/agentic-os/src/shared/domain/bandit.ts'),
      'export const x = 2;\n',
    );
    const miss = mod.selectPriorArtifacts(manifest, { repoRoot: tmp });
    expect(miss.reuse_mode).toBe('regenerate');
    expect(miss.prior_artifacts).toBeNull();
  });
});

describe('V5 applyLearnedTargetToDetail', () => {
  it('reduces target when learned below baseline', async () => {
    const { applyLearnedTargetToDetail } = await load('graph-policy.mjs');
    const r = applyLearnedTargetToDetail(
      { target: 4, floor: 4, ceiling: 8 },
      'discover',
      { discover: 3 },
    );
    expect(r.target).toBe(3);
    expect(r.applied).toBe(true);
  });

  it('does not apply for missing phase', async () => {
    const { applyLearnedTargetToDetail } = await load('graph-policy.mjs');
    const r = applyLearnedTargetToDetail(
      { target: 4, floor: 4, ceiling: 8 },
      'discover',
      {},
    );
    expect(r.applied).toBe(false);
    expect(r.target).toBe(4);
  });
});
