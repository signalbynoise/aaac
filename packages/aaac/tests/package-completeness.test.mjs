/**
 * Packaging guard: npm templates must ship complete swarm rosters.
 * Prevents shipping validation (etc.) with empty agents → validation-slot-* failures.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './fixtures/paths.mjs';
import { extractRoleInitialSummary } from '../src/run-engine/agent-progress-contract.mjs';
import {
  loadGraphSwarmConfig,
  resolveAgentSpecsForPhase,
  readAgentSpecContent,
} from '../src/run-engine/swarm-agent-specs.mjs';
import { resolveExpectedAgentSpecs } from '../src/run-engine/expected-agent-specs.mjs';

const TEMPLATE_CURSOR = path.join(REPO_ROOT, 'packages/aaac/templates/cursor');
const CLI = path.join(REPO_ROOT, 'packages/aaac/src/cli.mjs');
const GRAPH_GENERATOR = path.join(
  REPO_ROOT,
  'packages/aaac/src/generators/generate-graph.mjs',
);

/** Skills that must never ship without a non-empty agent roster. */
const REQUIRED_SKILL_ROSTERS = {
  validation: [
    'gate-validate-confidence',
    'gate-validate-complexity',
    'gate-validate-requirements',
  ],
  rollback: ['gate-rollback-feasibility', 'gate-rollback-verification'],
  reporting: ['report-completeness-review', 'report-factual-review'],
  'investigation-lite': [
    'investigate-lite-exists',
    'investigate-lite-dependencies',
    'investigate-lite-constraints',
  ],
  'root-cause': ['root-cause-analyst', 'fix-hypothesis-validate'],
  execution: ['code-author'],
  'fitness-functions': [
    'boundary-review',
    'doc-conformance',
    'fallow-check-changed',
  ],
  'impact-analysis': ['impact-analysis', 'dependency-analysis'],
  'dependency-graph': ['dependency-analysis', 'boundary-review'],
};

function materializeTemplateAaac() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-pkg-complete-'));
  const cursorRoot = path.join(temporaryRoot, '.cursor');
  fs.cpSync(TEMPLATE_CURSOR, cursorRoot, { recursive: true });
  execFileSync(process.execPath, [GRAPH_GENERATOR, '--root', cursorRoot], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
  return {
    temporaryRoot,
    cursorRoot,
    aaacRoot: path.join(cursorRoot, 'aaac'),
  };
}

describe('package completeness (npm templates)', () => {
  it('ships non-empty agent rosters and Role summaries for every required skill', () => {
    const { temporaryRoot, cursorRoot, aaacRoot } = materializeTemplateAaac();
    try {
      const config = loadGraphSwarmConfig(aaacRoot);

      for (const [skill, ids] of Object.entries(REQUIRED_SKILL_ROSTERS)) {
        expect(config.skillAgents[skill], `${skill} roster`).toEqual(ids);

        for (const id of ids) {
          const relPath = config.agentPaths[id];
          expect(relPath, `${skill}:${id} path`).toBeTruthy();
          const fullPath = path.join(cursorRoot, relPath);
          expect(fs.existsSync(fullPath), `${skill}:${id} file`).toBe(true);
          const summary = extractRoleInitialSummary(
            fs.readFileSync(fullPath, 'utf8'),
          );
          expect(summary, `${id} Role summary`).toBeTruthy();
          expect(summary.length).toBeLessThanOrEqual(180);
        }
      }
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('resolves validate agents to gate-validate-* (never validation-slot-*)', () => {
    const { temporaryRoot, cursorRoot, aaacRoot } = materializeTemplateAaac();
    try {
      const specs = resolveAgentSpecsForPhase({
        aaacRoot,
        phase: 'validate',
        manifest: { verb: 'check', command: 'check-architecture' },
        count: 3,
      });

      expect(specs.map((s) => s.id)).toEqual([
        'gate-validate-confidence',
        'gate-validate-complexity',
        'gate-validate-requirements',
      ]);
      expect(specs.every((s) => !s.synthetic)).toBe(true);
      expect(specs.every((s) => !/-slot-\d+$/.test(s.id))).toBe(true);

      const expected = resolveExpectedAgentSpecs(
        { verb: 'check', command: 'check-architecture', phase: 'validate' },
        {
          phase: 'validate',
          aaacRoot,
          cursorRoot,
        },
      );
      expect(expected).toHaveLength(3);
      for (const entry of expected) {
        expect(entry.initial_summary).toBeTruthy();
      }
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('init from package templates produces a workspace that can resolve validate Role summaries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-completeness-init-'));
    try {
      execFileSync(
        process.execPath,
        [CLI, 'init', '--yes', '--force', '--dir', dir],
        {
          cwd: REPO_ROOT,
          stdio: 'pipe',
        },
      );

      const cursorRoot = path.join(dir, '.cursor');
      const aaacRoot = path.join(cursorRoot, 'aaac');
      const graph = fs.readFileSync(path.join(aaacRoot, 'graph.yaml'), 'utf8');
      expect(graph).toContain(
        'agents: [gate-validate-confidence, gate-validate-complexity, gate-validate-requirements]',
      );

      for (const id of REQUIRED_SKILL_ROSTERS.validation) {
        expect(
          fs.existsSync(path.join(cursorRoot, 'agents', `${id}.md`)),
          `installed ${id}.md`,
        ).toBe(true);
      }

      const specs = resolveAgentSpecsForPhase({
        aaacRoot,
        phase: 'validate',
        manifest: { verb: 'check', command: 'check-architecture' },
        count: 3,
      });
      expect(specs.map((s) => s.id)).toEqual(REQUIRED_SKILL_ROSTERS.validation);

      for (const spec of specs) {
        const content = readAgentSpecContent(cursorRoot, spec.relPath);
        const summary = extractRoleInitialSummary(content);
        expect(summary, `${spec.id} installed Role`).toBeTruthy();
      }

      const expected = resolveExpectedAgentSpecs(
        { verb: 'check', command: 'check-architecture', phase: 'validate' },
        { phase: 'validate', aaacRoot, cursorRoot },
      );
      expect(expected).toHaveLength(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
