/**
 * V6 maturity proxy: warm retrieve returns focused paths vs cold empty memory.
 * Full live agent files_read proof remains experience-maturity harness after publish.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const EXP = path.join(PACKAGE_ROOT, 'src/run-engine/experience');
const TEMPLATE_RETRIEVAL_YAML = path.join(
  PACKAGE_ROOT,
  'templates/cursor/aaac/experience/retrieval.yaml',
);

describe('V6 maturity proxy (cold vs warm retrieve)', () => {
  let tmp;
  let prevRoot;
  let prevProvider;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-v6-mat-'));
    prevRoot = process.env.AAAC_WORKSPACE_ROOT;
    prevProvider = process.env.AAAC_EMBEDDING_PROVIDER;
    process.env.AAAC_WORKSPACE_ROOT = tmp;
    process.env.AAAC_EMBEDDING_PROVIDER = 'hash';
    const aaac = path.join(tmp, '.cursor', 'aaac');
    fs.mkdirSync(path.join(aaac, 'state'), { recursive: true });
    fs.mkdirSync(path.join(aaac, 'experience'), { recursive: true });
    fs.writeFileSync(
      path.join(aaac, 'experience', 'retrieval.yaml'),
      fs.readFileSync(TEMPLATE_RETRIEVAL_YAML, 'utf8'),
    );
    vi.resetModules();
  });

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.AAAC_WORKSPACE_ROOT;
    else process.env.AAAC_WORKSPACE_ROOT = prevRoot;
    if (prevProvider === undefined) delete process.env.AAAC_EMBEDDING_PROVIDER;
    else process.env.AAAC_EMBEDDING_PROVIDER = prevProvider;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('warm index shrinks discover candidate set vs cold empty', async () => {
    fs.mkdirSync(path.join(tmp, 'apps', 'shop', 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps', 'shop', 'unrelated'), { recursive: true });
    for (let i = 0; i < 20; i += 1) {
      fs.writeFileSync(
        path.join(tmp, 'apps', 'shop', 'unrelated', `noise-${i}.ts`),
        `export const n${i} = ${i}\n`,
      );
    }
    fs.writeFileSync(
      path.join(tmp, 'apps', 'shop', 'src', 'payments.ts'),
      'export function charge() { return 1 }\n',
    );
    fs.writeFileSync(
      path.join(tmp, 'apps', 'shop', 'src', 'webhook.ts'),
      'import { charge } from "./payments.js";\nexport const wh = charge;\n',
    );

    const { retrieveRepoMemory } = await import(path.join(EXP, 'retrieve-repo.mjs'));
    const { getEmbeddingProvider, resetEmbeddingProviderCache } = await import(
      path.join(EXP, 'embed/provider.mjs')
    );
    resetEmbeddingProviderCache();
    const provider = getEmbeddingProvider({ provider: 'hash', force: true });

    const cold = await retrieveRepoMemory(
      {
        command: 'review-module',
        intent: 'Review payment webhook charge path',
        verb: 'review',
        object: 'module',
      },
      { provider, emit: false },
    );
    expect(cold.meta.empty).toBe(true);
    expect(cold.focus_paths.length).toBe(0);

    const { buildRepoIndex } = await import(path.join(EXP, 'repo-index/build.mjs'));
    const built = await buildRepoIndex({
      root: tmp,
      provider,
      force: true,
      emit: false,
      maxFiles: 100,
    });
    expect(built.nodes).toBeGreaterThan(10);

    const warm = await retrieveRepoMemory(
      {
        command: 'review-module',
        intent: 'Review payment webhook charge path',
        verb: 'review',
        object: 'module',
      },
      { provider, emit: false },
    );
    expect(warm.meta.empty).not.toBe(true);
    expect(warm.focus_paths.length).toBeGreaterThan(0);
    expect(warm.focus_paths.length).toBeLessThanOrEqual(12);
    // Massive shrink vs full tree walk of 22+ files
    expect(warm.focus_paths.length).toBeLessThan(built.nodes);
    const hit = warm.focus_paths.join(' ');
    expect(/payment|webhook|charge/i.test(hit)).toBe(true);
  });
});
