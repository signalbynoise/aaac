/**
 * Pluggable embedding provider factory.
 * Env: AAAC_EMBEDDING_PROVIDER = local | openai | stub | hash
 */
import { loadRetrievalConfig } from "../paths.mjs";
import { tryRequireDep } from "../deps.mjs";
import { createHashProvider } from "./hash.mjs";
import { createStubProvider } from "./stub.mjs";
import { createLocalProvider } from "./local.mjs";
import { createRemoteProvider } from "./remote.mjs";

/** @type {ReturnType<typeof createHashProvider>|null} */
let cached = null;
let cachedKey = null;

/**
 * @param {{ provider?: string, force?: boolean }} [options]
 */
export function resolveProviderName(options = {}) {
  if (options.provider) return String(options.provider).toLowerCase();
  const env = process.env.AAAC_EMBEDDING_PROVIDER;
  if (env) return String(env).toLowerCase();
  return loadRetrievalConfig().embedding.default_provider || "local";
}

/**
 * @param {{ provider?: string, force?: boolean }} [options]
 */
export function getEmbeddingProvider(options = {}) {
  const cfg = loadRetrievalConfig();
  const name = resolveProviderName(options);
  const key = `${name}:${cfg.embedding.local_model}:${cfg.embedding.remote_model}:${cfg.embedding.dimensions}`;
  if (!options.force && cached && cachedKey === key) return cached;

  const dims = cfg.embedding.dimensions;
  let provider;
  switch (name) {
    case "stub":
      provider = createStubProvider(dims);
      break;
    case "hash":
      provider = createHashProvider(dims);
      break;
    case "openai":
    case "remote":
      provider = createRemoteProvider({
        model: process.env.AAAC_EMBEDDING_MODEL || cfg.embedding.remote_model,
        dims,
      });
      break;
    case "local":
      if (!tryRequireDep("@huggingface/transformers")) {
        throw new Error(
          "AAAC_EMBEDDING_PROVIDER=local requires @huggingface/transformers. " +
            "Use default hash (matches packaged-index) or install the dependency and rebuild.",
        );
      }
      provider = createLocalProvider(
        process.env.AAAC_EMBEDDING_MODEL || cfg.embedding.local_model,
        dims,
      );
      break;
    default:
      // Unknown provider → packaged-compatible hash (collective corpus space)
      provider = createHashProvider(dims);
      break;
  }

  cached = provider;
  cachedKey = key;
  return provider;
}

/** Test helper */
export function resetEmbeddingProviderCache() {
  cached = null;
  cachedKey = null;
}
