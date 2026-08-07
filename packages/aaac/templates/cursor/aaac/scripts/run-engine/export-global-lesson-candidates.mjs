#!/usr/bin/env node
/**
 * Export high-confidence, sanitizable lessons from local state for promotion
 * into packages/aaac/templates/cursor/aaac/experience/global-lessons.json.
 *
 * Usage:
 *   node export-global-lesson-candidates.mjs [--min-observed 5] [--min-confidence 0.75] [--write <path>]
 */
import path from "path";
import { fileURLToPath } from "url";
import { writeJson, isoNow, AAAC_ROOT, REPO_ROOT } from "./lib.mjs";
import { exportGlobalLessonCandidates } from "./experience/export.mjs";
import {
  PROMOTE_MIN_OBSERVED,
  PROMOTE_MIN_CONFIDENCE,
} from "./experience/paths.mjs";

function parseArgs(argv) {
  const out = {
    minObserved: PROMOTE_MIN_OBSERVED,
    minConfidence: PROMOTE_MIN_CONFIDENCE,
    write: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--min-observed") out.minObserved = Number(argv[++i]);
    else if (argv[i] === "--min-confidence") out.minConfidence = Number(argv[++i]);
    else if (argv[i] === "--write") out.write = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const candidates = exportGlobalLessonCandidates({
  minObserved: args.minObserved,
  minConfidence: args.minConfidence,
});

const payload = {
  version: 1,
  exported_at: isoNow(),
  description:
    "Candidates for packages/aaac global corpus. Review, then merge into global-lessons.json before publish.",
  min_observed: args.minObserved,
  min_confidence: args.minConfidence,
  count: candidates.length,
  lessons: Object.fromEntries(candidates.map((c) => [c.id, c])),
};

if (args.write) {
  const dest = path.isAbsolute(args.write)
    ? args.write
    : path.join(REPO_ROOT, args.write);
  writeJson(dest, {
    version: 1,
    updated_at: isoNow(),
    description:
      "Packaged global experience corpus shipped with @ludecker/aaac. Evidence-backed lessons only — no project-private run IDs.",
    lessons: payload.lessons,
  });
}

console.log(JSON.stringify(payload, null, 2));

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (!isMain) {
  // imported
}

// Hint for maintainers when no --write
if (!args.write && candidates.length) {
  const hint = path.join(
    AAAC_ROOT,
    "..",
    "..",
    "packages",
    "aaac",
    "templates",
    "cursor",
    "aaac",
    "experience",
    "global-lessons.json",
  );
  console.error(
    `\n# Review candidates, then:\n# node export-global-lesson-candidates.mjs --write ${hint}\n`,
  );
}
