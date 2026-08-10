#!/usr/bin/env node
/**
 * Rebuild V6 repository vector graph + embeddings.
 *
 * Usage:
 *   node rebuild-repo-index.mjs [--provider stub|hash|local|openai] [--force]
 *   node rebuild-repo-index.mjs --ensure
 */
import path from "path";
import { fileURLToPath } from "url";
import {
  buildRepoIndex,
  ensureRepoIndex,
} from "./experience/repo-index/build.mjs";
import {
  getEmbeddingProvider,
  resetEmbeddingProviderCache,
} from "./experience/embed/provider.mjs";

function parseArgs(argv) {
  const out = { provider: null, force: false, ensure: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--provider") out.provider = argv[++i];
    if (argv[i] === "--force") out.force = true;
    if (argv[i] === "--ensure") out.ensure = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.provider) {
    process.env.AAAC_EMBEDDING_PROVIDER = args.provider;
    resetEmbeddingProviderCache();
  }
  const provider = getEmbeddingProvider({
    provider: args.provider || undefined,
  });
  const result = args.ensure
    ? await ensureRepoIndex({ provider, force: args.force })
    : await buildRepoIndex({ provider, force: args.force });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
