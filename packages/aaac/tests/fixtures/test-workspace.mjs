import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(fixtureDir, '../../../..');
const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-vitest-workspace-'));

function symlinkChildren(sourceDir, targetDir, excludedNames = new Set()) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (excludedNames.has(entry.name)) continue;
    fs.symlinkSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
  }
}

function copyWebsiteFixture() {
  const sourceApps = path.join(sourceRoot, 'apps');
  const targetApps = path.join(workspaceRoot, 'apps');
  symlinkChildren(sourceApps, targetApps, new Set(['website']));
  fs.cpSync(path.join(sourceApps, 'website'), path.join(targetApps, 'website'), {
    recursive: true,
    filter(source) {
      return !source.endsWith(`${path.sep}dist`) && !source.endsWith(`${path.sep}node_modules`);
    },
  });
  const sourceModules = path.join(sourceApps, 'website', 'node_modules');
  if (fs.existsSync(sourceModules)) {
    fs.symlinkSync(sourceModules, path.join(targetApps, 'website', 'node_modules'));
  }
}

function createIsolatedWorkspace() {
  symlinkChildren(sourceRoot, workspaceRoot, new Set(['.cursor', 'apps']));
  copyWebsiteFixture();

  const sourceCursor = path.join(sourceRoot, '.cursor');
  const targetCursor = path.join(workspaceRoot, '.cursor');
  symlinkChildren(sourceCursor, targetCursor, new Set(['aaac']));

  const sourceAaac = path.join(sourceCursor, 'aaac');
  const targetAaac = path.join(targetCursor, 'aaac');
  symlinkChildren(sourceAaac, targetAaac, new Set(['state']));

  for (const relative of ['runs', 'active-runs', 'sessions']) {
    fs.mkdirSync(path.join(targetAaac, 'state', relative), { recursive: true });
  }
}

createIsolatedWorkspace();
process.env.AAAC_WORKSPACE_ROOT = workspaceRoot;

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});
