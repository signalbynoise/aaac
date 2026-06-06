import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));

/** Resolve monorepo `.cursor/aaac` paths (override via env in CI). */
export function resolveAaacPaths() {
  const repoRoot =
    process.env.AAAC_REPO_ROOT ??
    path.resolve(fixtureDir, '../../../..');
  const cursorRoot =
    process.env.AAAC_CURSOR_ROOT ?? path.join(repoRoot, '.cursor');
  const aaacRoot = path.join(cursorRoot, 'aaac');

  return { repoRoot, cursorRoot, aaacRoot };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readYaml(filePath) {
  return yaml.parse(fs.readFileSync(filePath, 'utf8'));
}

/** Load graph.yaml verb_runtime and runtime-registry.json from dogfood SSOT. */
export function loadAaacRuntime() {
  const { aaacRoot, repoRoot, cursorRoot } = resolveAaacPaths();
  const graphPath = path.join(aaacRoot, 'graph.yaml');
  const registryPath = path.join(aaacRoot, 'runtime-registry.json');

  for (const filePath of [graphPath, registryPath]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `AAAC runtime file missing: ${filePath}. Run aaac:generate from repo root.`,
      );
    }
  }

  const graph = readYaml(graphPath);
  const registry = readJson(registryPath);
  const verbRuntime = graph?.verb_runtime;

  if (!verbRuntime || typeof verbRuntime !== 'object') {
    throw new Error('graph.yaml missing verb_runtime block');
  }

  return {
    aaacRoot,
    cursorRoot,
    repoRoot,
    graph,
    registry,
    verbRuntime,
  };
}

/** Pending phases for a verb from graph.yaml verb_runtime (SSOT). */
export function getVerbRuntimePhases(verbRuntime, verb) {
  const phases = verbRuntime[verb];
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new Error(`verb_runtime missing or empty for verb "${verb}"`);
  }
  return phases;
}

/** Assert a registry command resolves and pending matches verb_runtime. */
export function assertCommandMatchesVerbRuntime(
  registry,
  verbRuntime,
  commandName,
  { verb } = {},
) {
  const entry = registry.commands?.[commandName];
  if (!entry) {
    throw new Error(`runtime-registry missing command "${commandName}"`);
  }

  const expectedVerb = verb ?? entry.verb;
  const expectedPending = getVerbRuntimePhases(verbRuntime, expectedVerb);

  if (entry.verb !== expectedVerb) {
    throw new Error(
      `command "${commandName}" verb is "${entry.verb}", expected "${expectedVerb}"`,
    );
  }

  if (JSON.stringify(entry.pending) !== JSON.stringify(expectedPending)) {
    throw new Error(
      `command "${commandName}" pending does not match verb_runtime.${expectedVerb}`,
    );
  }

  return { entry, expectedPending };
}

/** Collect non-alias commands for a verb. */
export function listCommandsForVerb(registry, verb) {
  return Object.entries(registry.commands ?? {})
    .filter(([, entry]) => entry.verb === verb && !entry.alias_of)
    .map(([name]) => name);
}

export const hasBaseUrl = () => Boolean(process.env.PLAYWRIGHT_BASE_URL);

export const PUBLIC_SMOKE_ROUTES = ['/', '/guide'];
