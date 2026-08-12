/**
 * V6 repository vector graph — graph, index, retrieve, discover protocol.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const EXP = path.join(PACKAGE_ROOT, 'src/run-engine/experience');
const SKILL = path.join(
  PACKAGE_ROOT,
  'templates/cursor/skills/shared/discovery/SKILL.md',
);
const TEMPLATE_RETRIEVAL_YAML = path.join(
  PACKAGE_ROOT,
  'templates/cursor/aaac/experience/retrieval.yaml',
);

describe('V6 repo graph', () => {
  let tmp;
  let prevRoot;
  let prevProvider;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-v6-'));
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
    fs.writeFileSync(
      path.join(aaac, 'experience', 'global-lessons.json'),
      JSON.stringify({ version: 1, lessons: {} }),
    );
    fs.writeFileSync(
      path.join(aaac, 'state', 'lessons.json'),
      JSON.stringify({ version: 1, lessons: {} }),
    );
    fs.writeFileSync(
      path.join(aaac, 'state', 'experience-stats.json'),
      JSON.stringify({ version: 1, signatures: {} }),
    );
    fs.writeFileSync(
      path.join(aaac, 'state', 'workspace-memory.json'),
      JSON.stringify({ version: 1, prefs: [] }),
    );
    vi.resetModules();
  });

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.AAAC_WORKSPACE_ROOT;
    else process.env.AAAC_WORKSPACE_ROOT = prevRoot;
    if (prevProvider === undefined) delete process.env.AAAC_EMBEDDING_PROVIDER;
    else process.env.AAAC_EMBEDDING_PROVIDER = prevProvider;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('upserts nodes with hashes and invalidates on drift', async () => {
    const {
      emptyRepoGraph,
      upsertNode,
      verifyRepoGraph,
      hashFile,
    } = await import(path.join(EXP, 'repo-graph.mjs'));

    const fileRel = 'src/hello.ts';
    const abs = path.join(tmp, fileRel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'export const hello = 1;\n');

    const graph = emptyRepoGraph();
    upsertNode(graph, {
      id: 'file:src/hello.ts',
      kind: 'file',
      path: fileRel,
      summary: 'hello module',
      source_files: [fileRel],
    });
    expect(graph.nodes['file:src/hello.ts'].source_hashes[fileRel]).toBe(
      hashFile(abs),
    );

    let v = verifyRepoGraph(graph);
    expect(v.invalidated).toBe(0);
    expect(graph.nodes['file:src/hello.ts'].valid).toBe(true);

    fs.writeFileSync(abs, 'export const hello = 2;\n');
    v = verifyRepoGraph(graph);
    expect(v.invalidated).toBe(1);
    expect(graph.nodes['file:src/hello.ts'].valid).toBe(false);
  });

  it('indexes and retrieves focus paths for an intent', async () => {
    const { resetEmbeddingProviderCache } = await import(
      path.join(EXP, 'embed/provider.mjs')
    );
    resetEmbeddingProviderCache();

    fs.mkdirSync(path.join(tmp, 'apps', 'demo', 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'apps', 'demo', 'src', 'checkout.ts'),
      'export function checkout() { return true }\n',
    );
    fs.writeFileSync(
      path.join(tmp, 'apps', 'demo', 'src', 'cart.ts'),
      'import { checkout } from "./checkout.js";\nexport const cart = checkout;\n',
    );

    const { buildRepoIndex } = await import(
      path.join(EXP, 'repo-index/build.mjs')
    );
    const { getEmbeddingProvider } = await import(
      path.join(EXP, 'embed/provider.mjs')
    );
    const { retrieveRepoMemory } = await import(
      path.join(EXP, 'retrieve-repo.mjs')
    );

    const provider = getEmbeddingProvider({ provider: 'hash', force: true });
    const built = await buildRepoIndex({
      root: tmp,
      provider,
      force: true,
      emit: false,
      maxFiles: 50,
    });
    expect(built.ok).toBe(true);
    expect(built.nodes).toBeGreaterThan(0);

    const packet = await retrieveRepoMemory(
      {
        command: 'review-module',
        verb: 'review',
        object: 'module',
        intent: 'Review checkout cart flow',
        domain: 'demo',
      },
      { provider, emit: false },
    );
    expect(packet.meta.empty).not.toBe(true);
    expect(packet.nodes.length).toBeGreaterThan(0);
    expect(packet.focus_paths.length).toBeGreaterThan(0);
    const joined = packet.focus_paths.join(' ');
    expect(/checkout|cart/i.test(joined)).toBe(true);
  });

  it('selectExperienceForContext includes repo_memory', async () => {
    process.env.AAAC_EMBEDDING_PROVIDER = 'stub';
    vi.resetModules();
    const { resetEmbeddingProviderCache } = await import(
      path.join(EXP, 'embed/provider.mjs')
    );
    resetEmbeddingProviderCache();
    const { selectExperienceForContext } = await import(
      path.join(EXP, 'select.mjs')
    );
    const { getEmbeddingProvider } = await import(
      path.join(EXP, 'embed/provider.mjs')
    );
    const provider = getEmbeddingProvider({ provider: 'stub', force: true });

    const packet = await selectExperienceForContext(
      {
        command: 'review-module',
        verb: 'review',
        object: 'module',
        intent: 'Check module boundaries',
        phase: 'discover',
      },
      { provider, ensureIndex: false, emitRepoEvents: false, maxLessons: 1 },
    );

    expect(packet).toHaveProperty('repo_memory');
    expect(packet.repo_memory).toHaveProperty('focus_paths');
    expect(packet.repo_memory).toHaveProperty('nodes');
    expect(packet.repo_memory).toHaveProperty('invariants');
    expect(packet.repo_memory).toHaveProperty('meta');
    expect(Array.isArray(packet.context_hint.recommended_focus_paths)).toBe(
      true,
    );
  });
});

describe('V6 import path resolution', () => {
  let tmp;
  let prevRoot;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-v6-scan-'));
    prevRoot = process.env.AAAC_WORKSPACE_ROOT;
    process.env.AAAC_WORKSPACE_ROOT = tmp;
    fs.mkdirSync(path.join(tmp, 'src', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.cursor', 'aaac', 'experience'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmp, '.cursor', 'aaac', 'experience', 'retrieval.yaml'),
      fs.readFileSync(TEMPLATE_RETRIEVAL_YAML, 'utf8'),
    );
    fs.writeFileSync(
      path.join(tmp, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { paths: { '@/*': ['./src/*'] } },
      }),
    );
    fs.writeFileSync(
      path.join(tmp, 'src', 'lib', 'utils.ts'),
      'export const cn = (...a) => a.join(" ");\n',
    );
    fs.writeFileSync(
      path.join(tmp, 'src', 'app.ts'),
      'import { cn } from "@/lib/utils";\nexport const x = cn("a");\n',
    );
    vi.resetModules();
  });

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.AAAC_WORKSPACE_ROOT;
    else process.env.AAAC_WORKSPACE_ROOT = prevRoot;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('resolves @/ path aliases into import edges', async () => {
    const { loadPathAliases, resolveImportPath } = await import(
      path.join(EXP, 'repo-index/files.mjs')
    );
    const { scanWorkspace } = await import(
      path.join(EXP, 'repo-index/scan.mjs')
    );
    const aliases = loadPathAliases(tmp);
    expect(aliases.some((a) => a.prefix === '@/')).toBe(true);
    expect(resolveImportPath('src/app.ts', '@/lib/utils', tmp, aliases)).toBe(
      'src/lib/utils.ts',
    );

    const scanned = await scanWorkspace({ root: tmp, maxFiles: 50 });
    const imports = scanned.edges.filter((e) => e.kind === 'imports');
    expect(imports.some((e) => e.from === 'file:src/app.ts' && e.to === 'file:src/lib/utils.ts')).toBe(
      true,
    );
  });
});

describe('V6 discover protocol templates', () => {
  it('requires phase_context and retrieve-then-verify', () => {
    const skill = fs.readFileSync(SKILL, 'utf8');
    expect(skill).toMatch(/phase_context\.json/);
    expect(skill).toMatch(/Retrieve-then-verify/);
    expect(skill).toMatch(/repo_memory/);
    expect(skill).toMatch(/focus_spans/);
    expect(skill).toMatch(/graph-native|Progressive reading/i);
    expect(skill).toMatch(/retrieval_miss|confirmed/);
    expect(skill).toMatch(/stale/);

    for (const agent of [
      'discovery-inventory.md',
      'discovery-boundaries.md',
      'discovery-ssot.md',
    ]) {
      const text = fs.readFileSync(
        path.join(PACKAGE_ROOT, 'templates/cursor/agents', agent),
        'utf8',
      );
      expect(text).toMatch(/graph packet|phase_context\.json|repo_memory/i);
      expect(text).toMatch(/retrieval_miss|Read known|graph-native|envelope/i);
    }
  });
});
