#!/usr/bin/env node
/** Reconstruct chronological trace for a Run. Usage: log-trace.mjs <run_id> */
import { loadRunManifest } from "./lib.mjs";
import { buildTrace } from "./log.mjs";

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: log-trace.mjs <run_id>");
  process.exit(1);
}

const manifest = loadRunManifest(runId);
if (!manifest) {
  console.error(`Run not found: ${runId}`);
  process.exit(1);
}

console.log(buildTrace(manifest));
