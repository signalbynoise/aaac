import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, SOURCE_REPO_ROOT } from './fixtures/paths.mjs';

const TEMPLATE_CURSOR_ROOT = path.join(SOURCE_REPO_ROOT, 'packages/aaac/templates/cursor');
const TEMPLATE_OVERLAY = path.join(
  TEMPLATE_CURSOR_ROOT,
  'aaac/graph.project.yaml',
);

const GRAPH_GENERATOR = path.join(
  REPO_ROOT,
  'packages/aaac/src/generators/generate-graph.mjs',
);
const LIVE_REGISTRY_GENERATOR = path.join(
  REPO_ROOT,
  '.cursor/aaac/scripts/generate-runtime-registry.mjs',
);
const TEMPLATE_REGISTRY_GENERATOR = path.join(
  TEMPLATE_CURSOR_ROOT,
  'aaac/scripts/generate-runtime-registry.mjs',
);
const PRESERVED_GENERATED_AT = '2000-01-01T00:00:00.000Z';
const PRESERVED_MTIME = new Date('2001-01-01T00:00:00.000Z');
const SEMANTIC_CHANGE_ALIAS = 'verify-generation-change';
const SEMANTIC_CHANGE_TARGET = 'check-architecture';
const REQUIRED_ROSTER_LINES = [
  'agents: [root-cause-analyst, fix-hypothesis-validate]',
  'agents: [gate-validate-confidence, gate-validate-complexity, gate-validate-requirements]',
  'agents: [gate-rollback-feasibility, gate-rollback-verification]',
  'agents: [report-completeness-review, report-factual-review]',
];
const REQUIRED_AGENT_IDS = [
  'root-cause-analyst',
  'fix-hypothesis-validate',
  'gate-validate-confidence',
  'gate-validate-complexity',
  'gate-validate-requirements',
  'gate-rollback-feasibility',
  'gate-rollback-verification',
  'report-completeness-review',
  'report-factual-review',
];

function runTemplateGeneration(cursorRoot) {
  execFileSync(process.execPath, [GRAPH_GENERATOR, '--root', cursorRoot], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
}

function readGeneratedFiles(cursorRoot) {
  const graphPath = path.join(cursorRoot, 'aaac/graph.yaml');
  const registryPath = path.join(cursorRoot, 'aaac/runtime-registry.json');
  return {
    graph: fs.readFileSync(graphPath),
    registry: fs.readFileSync(registryPath),
    registryPath,
  };
}

function preserveRegistryMetadata(registryPath) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  registry.generated_at = PRESERVED_GENERATED_AT;
  const content = `${JSON.stringify(registry, null, 2)}\n`;
  fs.writeFileSync(registryPath, content);
  fs.utimesSync(registryPath, PRESERVED_MTIME, PRESERVED_MTIME);
  return content;
}

function addSemanticGraphChange(cursorRoot) {
  const ontologyPath = path.join(cursorRoot, 'aaac/ontology.json');
  const ontology = JSON.parse(fs.readFileSync(ontologyPath, 'utf8'));
  ontology.command_aliases[SEMANTIC_CHANGE_ALIAS] = SEMANTIC_CHANGE_TARGET;
  fs.writeFileSync(ontologyPath, `${JSON.stringify(ontology, null, 2)}\n`);
}

const template = fs.readFileSync(TEMPLATE_OVERLAY, 'utf8');
const HAS_LUDECKER_OVERLAY = fs.existsSync(path.join(SOURCE_REPO_ROOT, '.cursor/aaac/graph.project.yaml'))
  && fs.readFileSync(path.join(SOURCE_REPO_ROOT, '.cursor/aaac/graph.project.yaml'), 'utf8').includes('write-article');

it('keeps the npm template overlay generic without slug resolvers', () => {
  expect(template).not.toMatch(/^resolvers:/m);
  expect(template).not.toContain('update-module-by-slug');
  expect(template).not.toContain('domains/cms');
  expect(template).not.toContain('write-article');
  expect(template).not.toContain('aaac-publish');
  expect(template).not.toContain('ludecker-design-system');
  expect(template).not.toContain('release-render');
});

it('includes verb orchestrators and the shared registry in the npm template', () => {
  expect(template).toContain('verb-fix:');
  expect(template).toContain('verb-update:');
  expect(template).toContain('release-app:');
  expect(template).toContain('test-function:');
  expect(template).toContain('skills/shared/discovery');
});

it.skipIf(!HAS_LUDECKER_OVERLAY)('keeps domain resolvers and project orchestrators in the Lüdecker overlay', () => {
  const overlay = fs.readFileSync(path.join(SOURCE_REPO_ROOT, '.cursor/aaac/graph.project.yaml'), 'utf8');
  expect(overlay).toContain('update-module-by-slug');
  expect(overlay).toContain('cms-update');
  expect(overlay).toContain('write-article');
  expect(overlay).toContain('ludecker-design-system');
});

it('includes the remediate-app orchestrator in the npm template', () => {
  expect(template).toContain('remediate-app:');
  expect(template).toContain('skills/shared/remediation/orchestrator');
});

it('keeps the npm template overlay under the size budget', () => {
  const templateLines = template.split('\n').length;
  expect(templateLines).toBeLessThan(280);
});

it('keeps live and package-template registry generators byte-identical', () => {
  expect(fs.readFileSync(LIVE_REGISTRY_GENERATOR)).toEqual(
    fs.readFileSync(TEMPLATE_REGISTRY_GENERATOR),
  );
});

it('generates stable graph and registry files until semantic inputs change', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-graph-template-'));
  const cursorRoot = path.join(temporaryRoot, '.cursor');
  try {
    fs.cpSync(TEMPLATE_CURSOR_ROOT, cursorRoot, { recursive: true });
    runTemplateGeneration(cursorRoot);
    const first = readGeneratedFiles(cursorRoot);
    runTemplateGeneration(cursorRoot);
    const second = readGeneratedFiles(cursorRoot);

    expect(second.graph).toEqual(first.graph);
    expect(second.registry).toEqual(first.registry);
    for (const rosterLine of REQUIRED_ROSTER_LINES) {
      expect(second.graph.toString('utf8')).toContain(rosterLine);
    }
    for (const id of REQUIRED_AGENT_IDS) {
      expect(second.graph.toString('utf8')).toContain(
        `  ${id}:\n    path: agents/${id}.md`,
      );
      expect(fs.existsSync(path.join(cursorRoot, 'agents', `${id}.md`))).toBe(true);
    }

    const preservedContent = preserveRegistryMetadata(second.registryPath);
    const preservedMtime = fs.statSync(second.registryPath).mtimeMs;
    runTemplateGeneration(cursorRoot);
    const unchanged = readGeneratedFiles(cursorRoot);
    expect(unchanged.registry.toString('utf8')).toBe(preservedContent);
    expect(JSON.parse(unchanged.registry).generated_at).toBe(PRESERVED_GENERATED_AT);
    expect(fs.statSync(unchanged.registryPath).mtimeMs).toBe(preservedMtime);

    addSemanticGraphChange(cursorRoot);
    runTemplateGeneration(cursorRoot);
    const changed = readGeneratedFiles(cursorRoot);
    const changedRegistry = JSON.parse(changed.registry);
    expect(changed.graph).not.toEqual(unchanged.graph);
    expect(changed.registry).not.toEqual(unchanged.registry);
    expect(changedRegistry.generated_at).not.toBe(PRESERVED_GENERATED_AT);
    expect(changedRegistry.aliases[SEMANTIC_CHANGE_ALIAS]).toBe(SEMANTIC_CHANGE_TARGET);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
