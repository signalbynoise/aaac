import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, RUN_ENGINE_DIR } from './fixtures/paths.mjs';

const VERIFY_SCRIPT = path.join(RUN_ENGINE_DIR, 'verify-website-build.mjs');

function runVerify(args = []) {
  return spawnSync('node', [VERIFY_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

describe('verify-website-build', () => {
  let tempDir = null;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('passes static asset check with --skip-build', () => {
    const result = runVerify(['--skip-build']);
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    expect(json.ok).toBe(true);
    expect(json.static_assets.status).toBe('pass');
    expect(json.build.status).toBe('skipped');
  });

  it('fails when index.html references a missing root asset', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-verify-'));
    const fakeWebsite = path.join(tempDir, 'website');
    fs.mkdirSync(path.join(fakeWebsite, 'public'), { recursive: true });
    fs.writeFileSync(
      path.join(fakeWebsite, 'index.html'),
      '<link rel="icon" href="/missing-icon.svg" />',
    );

    const indexPath = path.join(REPO_ROOT, 'apps/website/index.html');
    const backup = `${indexPath}.bak-test`;
    fs.renameSync(indexPath, backup);
    try {
      fs.writeFileSync(
        indexPath,
        '<link rel="icon" href="/missing-icon.svg" />',
      );
      const result = runVerify(['--skip-build']);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/missing-icon\.svg/);
    } finally {
      fs.unlinkSync(indexPath);
      fs.renameSync(backup, indexPath);
    }
  });
});
