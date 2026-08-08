import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { installAaac } from '../../src/lib/install.mjs';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(fixtureDir, '../..');
const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-vitest-workspace-'));

function ensureStubWebsite() {
  const target = path.join(workspaceRoot, 'apps/website');
  fs.mkdirSync(path.join(target, 'public'), { recursive: true });
  fs.mkdirSync(path.join(target, 'lib/nav'), { recursive: true });
  fs.writeFileSync(
    path.join(target, 'package.json'),
    JSON.stringify(
      {
        name: '@ludecker/website',
        private: true,
        scripts: {
          build: 'node -e "require(\'node:fs\').mkdirSync(\'dist\',{recursive:true}); require(\'node:fs\').writeFileSync(\'dist/.keep\',\'\')"',
          start: 'node -e "setInterval(()=>{}, 1e9)"',
        },
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(target, 'index.html'),
    '<!doctype html><html><head><link rel="icon" href="/favicon.ico" /></head><body></body></html>\n',
  );
  fs.writeFileSync(path.join(target, 'public/favicon.ico'), '');
}

function createIsolatedWorkspace() {
  fs.mkdirSync(path.join(workspaceRoot, 'packages'), { recursive: true });
  fs.symlinkSync(packageRoot, path.join(workspaceRoot, 'packages/aaac'));
  fs.writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: 'aaac-test-workspace', private: true }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(workspaceRoot, 'pnpm-workspace.yaml'),
    'packages:\n  - "apps/*"\n  - "packages/*"\n',
  );
  ensureStubWebsite();
  installAaac({
    targetDir: workspaceRoot,
    projectName: 'aaac-test-workspace',
    docsRoot: 'docs',
    packageRoot,
  });

  const projectConfigPath = path.join(workspaceRoot, '.cursor/aaac/project.config.json');
  const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  projectConfig.verify = {
    enabled: true,
    app_root: 'apps/website',
    index_html: 'apps/website/index.html',
    build: {
      command: 'pnpm',
      args: ['--filter', '@ludecker/website', 'build'],
    },
  };
  fs.writeFileSync(projectConfigPath, `${JSON.stringify(projectConfig, null, 2)}\n`);
}

createIsolatedWorkspace();
process.env.AAAC_WORKSPACE_ROOT = workspaceRoot;

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});
