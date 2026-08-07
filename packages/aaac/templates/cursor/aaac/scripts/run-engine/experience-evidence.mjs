#!/usr/bin/env node
/**
 * Thin CLI + compatibility facade for the experience layer.
 *
 * Implementation lives under ./experience/ (modular). Prefer:
 *   ./experience/select.mjs   — prepare-phase-context
 *   ./experience/process.mjs  — advance-phase / approve-run
 *   ./experience/export.mjs   — experience-export
 *
 * Usage:
 *   node experience-evidence.mjs --run-id <run_id> [--force]
 */
import path from "path";
import { fileURLToPath } from "url";
import { processRunExperience } from "./experience/process.mjs";

export * from "./experience/index.mjs";

async function main() {
  const args = process.argv.slice(2);
  const runIdIdx = args.indexOf("--run-id");
  const runId = runIdIdx >= 0 ? args[runIdIdx + 1] : args[0];
  const force = args.includes("--force");

  if (!runId) {
    console.error("Usage: experience-evidence.mjs --run-id <run_id> [--force]");
    process.exit(1);
  }

  const result = await processRunExperience(runId, { force });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
