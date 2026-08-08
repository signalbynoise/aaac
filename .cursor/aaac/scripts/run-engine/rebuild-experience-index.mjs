#!/usr/bin/env node
/**
 * Rebuild experience vector index.
 *
 * Usage:
 *   node rebuild-experience-index.mjs [--provider stub|hash|local|openai]
 *   node rebuild-experience-index.mjs --packaged [--provider hash]
 *
 * --packaged writes experience/packaged-index/ (ships with npm; hash by default).
 * Default rebuilds local state/experience-index from packaged ∪ local lessons.
 */
import path from "path";
import { fileURLToPath } from "url";
import {
  loadLessonsStore,
  loadPackagedGlobalLessons,
  mergeLessonCorpora,
} from "./experience/stores.mjs";
import {
  rebuildExperienceIndex,
  writePackagedExperienceIndex,
} from "./experience/index/build.mjs";
import {
  getEmbeddingProvider,
  resetEmbeddingProviderCache,
} from "./experience/embed/provider.mjs";

function parseArgs(argv) {
  const out = { provider: null, packaged: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--provider") out.provider = argv[++i];
    if (argv[i] === "--packaged") out.packaged = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.packaged) {
    process.env.AAAC_EMBEDDING_PROVIDER = args.provider || "hash";
    resetEmbeddingProviderCache();
    const packaged = loadPackagedGlobalLessons();
    const lessons = packaged?.lessons ?? {};
    const result = await writePackagedExperienceIndex(lessons);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.provider) {
    process.env.AAAC_EMBEDDING_PROVIDER = args.provider;
    resetEmbeddingProviderCache();
  }
  const merged = mergeLessonCorpora(loadPackagedGlobalLessons(), loadLessonsStore());
  const provider = getEmbeddingProvider({ force: true });
  const result = await rebuildExperienceIndex(merged, { provider });
  console.log(
    JSON.stringify({ ok: true, lessons: Object.keys(merged).length, ...result }, null, 2),
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
