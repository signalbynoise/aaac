import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root (ludecker/) */
export const REPO_ROOT = path.resolve(__dirname, '../../../..');

export const AAAC_ROOT = path.join(REPO_ROOT, '.cursor/aaac');
export const GRAPH_PATH = path.join(AAAC_ROOT, 'graph.yaml');
export const ENFORCEMENT_PATH = path.join(AAAC_ROOT, 'enforcement.json');
export const RUN_ENGINE_DIR = path.join(AAAC_ROOT, 'scripts/run-engine');
export const STATE_ROOT = path.join(AAAC_ROOT, 'state');
export const RUNS_ROOT = path.join(STATE_ROOT, 'runs');
export const ACTIVE_RUNS_DIR = path.join(STATE_ROOT, 'active-runs');

export const LIB_PATH = path.join(RUN_ENGINE_DIR, 'lib.mjs');
