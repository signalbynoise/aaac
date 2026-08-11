import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'url';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const EXPERIENCE_ROOT = path.join(
  PACKAGE_ROOT,
  'src/run-engine/experience',
);
const FILES_MODULE = path.join(
  EXPERIENCE_ROOT,
  'repo-index/files.mjs',
);
const SCAN_MODULE = path.join(
  EXPERIENCE_ROOT,
  'repo-index/scan.mjs',
);
const BUILD_MODULE = path.join(
  EXPERIENCE_ROOT,
  'repo-index/build.mjs',
);
const TEMPLATE_REPO_INDEX_ROOT = path.join(
  PACKAGE_ROOT,
  'templates/cursor/aaac/scripts/run-engine/experience/repo-index',
);
const REPO_GRAPH_RELATIVE_PATH = path.join(
  '.cursor',
  'aaac',
  'state',
  'repo-graph.json',
);
const REPO_INDEX_RELATIVE_PATH = path.join(
  '.cursor',
  'aaac',
  'state',
  'repo-index',
);

function writeWorkspaceFile(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function deterministicProvider() {
  return {
    id: 'repo-index-test',
    model: 'deterministic',
    dims: 2,
    async embed(texts) {
      return texts.map((text) => [String(text).length, 1]);
    },
  };
}

describe('repo indexer regressions', () => {
  let workspace;
  let previousWorkspaceRoot;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-repo-index-'));
    previousWorkspaceRoot = process.env.AAAC_WORKSPACE_ROOT;
    process.env.AAAC_WORKSPACE_ROOT = workspace;
    vi.resetModules();
  });

  afterEach(() => {
    if (previousWorkspaceRoot === undefined) {
      delete process.env.AAAC_WORKSPACE_ROOT;
    } else {
      process.env.AAAC_WORKSPACE_ROOT = previousWorkspaceRoot;
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('force rebuild purges stale graph nodes, metadata rows, and vector entries', async () => {
    writeWorkspaceFile(
      workspace,
      'src/current.ts',
      'export const current = true;\n',
    );
    writeWorkspaceFile(
      workspace,
      REPO_GRAPH_RELATIVE_PATH,
      `${JSON.stringify({
        version: 1,
        updated_at: null,
        nodes: {
          'file:src/deleted.ts': {
            id: 'file:src/deleted.ts',
            kind: 'file',
            path: 'src/deleted.ts',
            source_files: ['src/deleted.ts'],
          },
        },
        edges: [],
      })}\n`,
    );
    writeWorkspaceFile(
      workspace,
      path.join(REPO_INDEX_RELATIVE_PATH, 'meta.json'),
      `${JSON.stringify({
        version: 1,
        rows: {
          'file:src/deleted.ts': {
            hashes: { summary: 'stale' },
            provider: 'repo-index-test',
            model: 'deterministic',
          },
        },
        provider: 'repo-index-test',
        model: 'deterministic',
        dims: 2,
      })}\n`,
    );
    writeWorkspaceFile(
      workspace,
      path.join(REPO_INDEX_RELATIVE_PATH, 'vectors.json'),
      JSON.stringify({
        dims: 2,
        entries: {
          'file:src/deleted.ts::summary': [99, 1],
          'file:src/deleted.ts::api': [99, 1],
        },
      }),
    );

    const { buildRepoIndex } = await import(BUILD_MODULE);
    const result = await buildRepoIndex({
      root: workspace,
      force: true,
      emit: false,
      provider: deterministicProvider(),
    });
    const persisted = JSON.parse(
      fs.readFileSync(path.join(workspace, REPO_GRAPH_RELATIVE_PATH), 'utf8'),
    );
    const persistedMeta = JSON.parse(
      fs.readFileSync(
        path.join(workspace, REPO_INDEX_RELATIVE_PATH, 'meta.json'),
        'utf8',
      ),
    );
    const persistedVectors = JSON.parse(
      fs.readFileSync(
        path.join(workspace, REPO_INDEX_RELATIVE_PATH, 'vectors.json'),
        'utf8',
      ),
    );

    expect(result.ok).toBe(true);
    expect(Object.keys(persisted.nodes)).toEqual(['file:src/current.ts']);
    expect(persisted.nodes).not.toHaveProperty('file:src/deleted.ts');
    expect(Object.keys(persistedMeta.rows)).toEqual(['file:src/current.ts']);
    expect(Object.keys(persistedVectors.entries)).toHaveLength(4);
    expect(Object.keys(persistedVectors.entries)).toEqual(
      expect.arrayContaining([
        'file:src/current.ts::summary',
        'file:src/current.ts::api',
        'file:src/current.ts::invariant',
        'file:src/current.ts::trigger',
      ]),
    );
    expect(Object.keys(persistedVectors.entries)).not.toEqual(
      expect.arrayContaining([
        'file:src/deleted.ts::summary',
        'file:src/deleted.ts::api',
      ]),
    );
  });

  it('honors configured index_max_files when maxFiles is omitted', async () => {
    writeWorkspaceFile(
      workspace,
      '.cursor/aaac/experience/retrieval.yaml',
      'repo_memory:\n  index_max_files: 2\n',
    );
    writeWorkspaceFile(workspace, 'src/alpha.ts', 'export const alpha = 1;\n');
    writeWorkspaceFile(workspace, 'src/beta.ts', 'export const beta = 2;\n');
    writeWorkspaceFile(workspace, 'src/gamma.ts', 'export const gamma = 3;\n');

    const { scanWorkspace } = await import(SCAN_MODULE);
    const scanned = await scanWorkspace({ root: workspace });

    expect(scanned.files).toEqual(['src/alpha.ts', 'src/beta.ts']);
    expect(scanned.nodes).toHaveLength(2);
  });

  it('uses git inventory to exclude gitignored code files', async () => {
    execFileSync('git', ['init', '--quiet'], { cwd: workspace });
    writeWorkspaceFile(workspace, '.gitignore', 'src/ignored.ts\n');
    writeWorkspaceFile(
      workspace,
      'src/included.ts',
      'export const included = true;\n',
    );
    writeWorkspaceFile(
      workspace,
      'src/ignored.ts',
      'export const ignored = true;\n',
    );

    const { walkCodeFiles } = await import(FILES_MODULE);

    expect(walkCodeFiles(workspace)).toEqual(['src/included.ts']);
  });

  it('includes code inside nested git repositories', async () => {
    execFileSync('git', ['init', '--quiet'], { cwd: workspace });
    writeWorkspaceFile(
      workspace,
      'src/root.ts',
      'export const root = true;\n',
    );
    execFileSync('git', ['add', 'src/root.ts'], { cwd: workspace });

    const nestedRoot = path.join(workspace, 'vendor', 'nested-package');
    fs.mkdirSync(nestedRoot, { recursive: true });
    execFileSync('git', ['init', '--quiet'], { cwd: nestedRoot });
    writeWorkspaceFile(
      nestedRoot,
      'src/nested.ts',
      'export const nested = true;\n',
    );
    execFileSync('git', ['add', 'src/nested.ts'], { cwd: nestedRoot });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Repo Index Test',
        '-c',
        'user.email=repo-index@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: nestedRoot },
    );
    execFileSync('git', ['add', 'vendor/nested-package'], { cwd: workspace });

    const { walkCodeFiles } = await import(FILES_MODULE);

    expect(walkCodeFiles(workspace)).toEqual([
      'src/root.ts',
      'vendor/nested-package/src/nested.ts',
    ]);
  });

  it('falls back to deterministic filesystem inventory outside git', async () => {
    writeWorkspaceFile(
      workspace,
      'packages/zeta.ts',
      'export const zeta = true;\n',
    );
    writeWorkspaceFile(
      workspace,
      'src/alpha.ts',
      'export const alpha = true;\n',
    );
    writeWorkspaceFile(
      workspace,
      'node_modules/skipped.ts',
      'export const skipped = true;\n',
    );

    const { walkCodeFiles } = await import(FILES_MODULE);

    expect(walkCodeFiles(workspace)).toEqual([
      'src/alpha.ts',
      'packages/zeta.ts',
    ]);
  });

  it('stops non-git filesystem inventory at maxFiles', async () => {
    writeWorkspaceFile(workspace, 'alpha.ts', 'export const alpha = 1;\n');
    writeWorkspaceFile(workspace, 'beta.ts', 'export const beta = 2;\n');
    writeWorkspaceFile(workspace, 'gamma.ts', 'export const gamma = 3;\n');

    const { walkCodeFiles } = await import(FILES_MODULE);

    expect(walkCodeFiles(workspace, 2)).toEqual(['alpha.ts', 'beta.ts']);
  });

  it('resolves nested app @/ aliases used by dynamic imports', async () => {
    writeWorkspaceFile(
      workspace,
      'apps/demo/tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
      }),
    );
    writeWorkspaceFile(
      workspace,
      'apps/demo/src/main.ts',
      "export async function boot() { return import('@/pages/Home'); }\n",
    );
    writeWorkspaceFile(
      workspace,
      'apps/demo/src/pages/Home.ts',
      'export const Home = true;\n',
    );

    const { loadPathAliases, resolveImportPath, extractImportSpecs } =
      await import(FILES_MODULE);
    const { scanWorkspace } = await import(SCAN_MODULE);
    const aliases = loadPathAliases(workspace);
    const source = fs.readFileSync(path.join(workspace, 'apps/demo/src/main.ts'), 'utf8');

    expect(extractImportSpecs(source)).toEqual(['@/pages/Home']);
    expect(
      resolveImportPath(
        'apps/demo/src/main.ts',
        '@/pages/Home',
        workspace,
        aliases,
      ),
    ).toBe('apps/demo/src/pages/Home.ts');
    expect((await scanWorkspace({ root: workspace })).edges).toContainEqual({
      from: 'file:apps/demo/src/main.ts',
      to: 'file:apps/demo/src/pages/Home.ts',
      kind: 'imports',
      weight: 1,
    });
  });

  it('resolves dynamic imports through tsconfig baseUrl and path aliases', async () => {
    writeWorkspaceFile(
      workspace,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: 'src',
          paths: {
            '@core/*': ['core/*'],
          },
        },
      }),
    );
    writeWorkspaceFile(
      workspace,
      'src/app.ts',
      'export async function loadTool() { return import("@core/tool"); }\n',
    );
    writeWorkspaceFile(
      workspace,
      'src/core/tool.ts',
      'export const tool = true;\n',
    );

    const {
      extractImportSpecs,
      loadPathAliases,
      resolveImportPath,
    } = await import(FILES_MODULE);
    const { scanWorkspace } = await import(SCAN_MODULE);
    const source = fs.readFileSync(path.join(workspace, 'src/app.ts'), 'utf8');
    const aliases = loadPathAliases(workspace);
    const scanned = await scanWorkspace({ root: workspace });

    expect(extractImportSpecs(source)).toEqual(['@core/tool']);
    expect(resolveImportPath(
      'src/app.ts',
      '@core/tool',
      workspace,
      aliases,
    )).toBe('src/core/tool.ts');
    expect(scanned.edges).toContainEqual({
      from: 'file:src/app.ts',
      to: 'file:src/core/tool.ts',
      kind: 'imports',
      weight: 1,
    });
  });

  it('parses JSONC trailing commas and resolves baseUrl-only imports', async () => {
    writeWorkspaceFile(
      workspace,
      'tsconfig.json',
      [
        '{',
        '  // A paths map is intentionally absent.',
        '  "compilerOptions": {',
        '    "baseUrl": "src",',
        '  },',
        '}',
        '',
      ].join('\n'),
    );
    writeWorkspaceFile(
      workspace,
      'src/app.ts',
      'import { helper } from "shared/helper";\nexport { helper };\n',
    );
    writeWorkspaceFile(
      workspace,
      'src/shared/helper.ts',
      'export const helper = true;\n',
    );

    const { loadPathAliases, resolveImportPath } = await import(FILES_MODULE);
    const { scanWorkspace } = await import(SCAN_MODULE);
    const aliases = loadPathAliases(workspace);
    const scanned = await scanWorkspace({ root: workspace });

    expect(resolveImportPath(
      'src/app.ts',
      'shared/helper',
      workspace,
      aliases,
    )).toBe('src/shared/helper.ts');
    expect(scanned.edges).toContainEqual({
      from: 'file:src/app.ts',
      to: 'file:src/shared/helper.ts',
      kind: 'imports',
      weight: 1,
    });
  });

  it('does not create dangling edges to ignored or excluded files', async () => {
    execFileSync('git', ['init', '--quiet'], { cwd: workspace });
    writeWorkspaceFile(workspace, '.gitignore', 'src/ignored.ts\n');
    writeWorkspaceFile(
      workspace,
      'src/app.ts',
      [
        'import { ignored } from "./ignored";',
        'import { generated } from "../dist/generated";',
        'export const app = ignored || generated;',
        '',
      ].join('\n'),
    );
    writeWorkspaceFile(
      workspace,
      'src/ignored.ts',
      'export const ignored = true;\n',
    );
    writeWorkspaceFile(
      workspace,
      'dist/generated.ts',
      'export const generated = true;\n',
    );

    const { scanWorkspace } = await import(SCAN_MODULE);
    const scanned = await scanWorkspace({ root: workspace });

    expect(scanned.files).toEqual(['src/app.ts']);
    expect(scanned.edges).toEqual([]);
    expect(scanned.nodes.map((node) => node.id)).toEqual(['file:src/app.ts']);
  });

  it('resolves multiline imports to workspace package entries with reverse edges', async () => {
    writeWorkspaceFile(
      workspace,
      'packages/ui/package.json',
      JSON.stringify({ name: '@demo/ui' }),
    );
    writeWorkspaceFile(
      workspace,
      'packages/ui/src/index.ts',
      'export const Button = "button";\n',
    );
    writeWorkspaceFile(
      workspace,
      'apps/demo/src/app.ts',
      [
        'import {',
        '  Button,',
        '} from "@demo/ui";',
        '',
        'export const app = Button;',
        '',
      ].join('\n'),
    );

    const { scanWorkspace } = await import(SCAN_MODULE);
    const scanned = await scanWorkspace({ root: workspace });

    expect(scanned.edges).toEqual(expect.arrayContaining([
      {
        from: 'file:apps/demo/src/app.ts',
        to: 'file:packages/ui/src/index.ts',
        kind: 'imports',
        weight: 1,
      },
      {
        from: 'file:packages/ui/src/index.ts',
        to: 'file:apps/demo/src/app.ts',
        kind: 'imported_by',
        weight: 1,
      },
    ]));
  });

  it('extracts multiline export-from and side-effect imports without duplication', async () => {
    const { extractImportSpecs } = await import(FILES_MODULE);
    const source = [
      'export {',
      '  Button,',
      '} from "@demo/ui";',
      'import "./setup";',
      'import "./setup";',
      '',
    ].join('\n');

    expect(extractImportSpecs(source)).toEqual(['@demo/ui', './setup']);
  });

  it('extracts dynamic imports that include an options argument', async () => {
    const { extractImportSpecs } = await import(FILES_MODULE);
    const source = [
      'const data = import("./data.json", {',
      '  with: { type: "json" },',
      '});',
      '',
    ].join('\n');

    expect(extractImportSpecs(source)).toEqual(['./data.json']);
  });

  it('persists each import edge with its paired reverse edge', async () => {
    writeWorkspaceFile(
      workspace,
      'src/app.ts',
      'import { dependency } from "./dependency";\nexport { dependency };\n',
    );
    writeWorkspaceFile(
      workspace,
      'src/dependency.ts',
      'export const dependency = true;\n',
    );

    const { buildRepoIndex } = await import(BUILD_MODULE);
    const result = await buildRepoIndex({
      root: workspace,
      force: true,
      emit: false,
      provider: deterministicProvider(),
    });
    const persisted = JSON.parse(
      fs.readFileSync(path.join(workspace, REPO_GRAPH_RELATIVE_PATH), 'utf8'),
    );

    expect(result.ok).toBe(true);
    expect(persisted.edges).toEqual(expect.arrayContaining([
      {
        from: 'file:src/app.ts',
        to: 'file:src/dependency.ts',
        kind: 'imports',
        weight: 1,
      },
      {
        from: 'file:src/dependency.ts',
        to: 'file:src/app.ts',
        kind: 'imported_by',
        weight: 1,
      },
    ]));
  });

  it('keeps repo-index source and installation templates in parity', () => {
    for (const file of [
      'build.mjs',
      'files.mjs',
      'scan.mjs',
      'hnsw.mjs',
      'relations.mjs',
      'symbols.mjs',
      'span-retrieve.mjs',
      'calls.mjs',
    ]) {
      expect(
        fs.readFileSync(path.join(EXPERIENCE_ROOT, 'repo-index', file), 'utf8'),
      ).toBe(
        fs.readFileSync(path.join(TEMPLATE_REPO_INDEX_ROOT, file), 'utf8'),
      );
    }
  });
});
