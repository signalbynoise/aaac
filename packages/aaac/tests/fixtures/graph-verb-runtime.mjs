import fs from 'node:fs';
import { GRAPH_PATH } from './paths.mjs';

/** Parse verb_runtime block from graph.yaml without a YAML dependency. */
export function loadVerbRuntimeFromGraph() {
  const text = fs.readFileSync(GRAPH_PATH, 'utf8');
  const lines = text.split('\n');
  const result = {};
  let inBlock = false;

  for (const line of lines) {
    if (line.startsWith('verb_runtime:')) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (/^[a-z#]/.test(line) && !line.startsWith('  ')) break;
      const match = line.match(/^  (\w+): \[(.+)\]\s*$/);
      if (match) {
        result[match[1]] = match[2].split(',').map((s) => s.trim());
      }
    }
  }

  return result;
}
