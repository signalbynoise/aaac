import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './fixtures/paths.mjs';

const TEMPLATE_OVERLAY = path.join(
  REPO_ROOT,
  'packages/aaac/templates/cursor/aaac/graph.project.yaml',
);

const LUDECKER_OVERLAY = path.join(REPO_ROOT, '.cursor/aaac/graph.project.yaml');

describe('graph.project.yaml template vs Lüdecker overlay', () => {
  const template = fs.readFileSync(TEMPLATE_OVERLAY, 'utf8');
  const ludecker = fs.readFileSync(LUDECKER_OVERLAY, 'utf8');

  it('npm template overlay is generic (no slug resolvers)', () => {
    expect(template).not.toMatch(/^resolvers:/m);
    expect(template).not.toContain('update-module-by-slug');
    expect(template).not.toContain('domains/cms');
    expect(template).not.toContain('write-article');
    expect(template).not.toContain('aaac-publish');
    expect(template).not.toContain('ludecker-design-system');
    expect(template).not.toContain('release-render');
  });

  it('npm template includes verb orchestrators and shared registry', () => {
    expect(template).toContain('verb-fix:');
    expect(template).toContain('verb-update:');
    expect(template).toContain('release-app:');
    expect(template).toContain('test-function:');
    expect(template).toContain('skills/shared/discovery');
  });

  it('Lüdecker overlay keeps domain resolvers and project orchestrators', () => {
    expect(ludecker).toContain('update-module-by-slug');
    expect(ludecker).toContain('cms-update');
    expect(ludecker).toContain('write-article');
    expect(ludecker).toContain('ludecker-design-system');
  });

  it('template overlay is smaller than Lüdecker overlay', () => {
    const templateLines = template.split('\n').length;
    const ludeckerLines = ludecker.split('\n').length;
    expect(templateLines).toBeLessThan(ludeckerLines);
    expect(templateLines).toBeLessThan(250);
  });
});
