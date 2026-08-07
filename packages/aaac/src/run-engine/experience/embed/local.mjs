/**
 * Local MiniLM embeddings via @huggingface/transformers (Xenova).
 */
import { tryRequireDep } from "../deps.mjs";
import { createHashProvider } from "./hash.mjs";

let pipelinePromise = null;
let extractor = null;

async function getExtractor(model) {
  if (extractor) return extractor;
  const transformers = tryRequireDep("@huggingface/transformers");
  if (!transformers?.pipeline) {
    throw new Error("local embeddings unavailable: @huggingface/transformers not installed");
  }
  if (!pipelinePromise) {
    pipelinePromise = transformers.pipeline("feature-extraction", model);
  }
  extractor = await pipelinePromise;
  return extractor;
}

function meanPool(tensor) {
  // transformers.js returns Tensor with .data and .dims [batch, seq, hidden]
  const data = tensor.data ?? tensor;
  const dims = tensor.dims ?? null;
  if (!dims || dims.length < 3) {
    const arr = Float32Array.from(data);
    return arr;
  }
  const [, seq, hidden] = dims;
  const out = new Float32Array(hidden);
  for (let s = 0; s < seq; s += 1) {
    for (let h = 0; h < hidden; h += 1) {
      out[h] += data[s * hidden + h];
    }
  }
  for (let h = 0; h < hidden; h += 1) out[h] /= seq || 1;
  let norm = 0;
  for (let h = 0; h < hidden; h += 1) norm += out[h] * out[h];
  norm = Math.sqrt(norm) || 1;
  for (let h = 0; h < hidden; h += 1) out[h] /= norm;
  return out;
}

/**
 * @param {string} model
 * @param {number} dims
 */
export function createLocalProvider(model, dims = 384) {
  const fallback = createHashProvider(dims);
  return {
    id: "local",
    model,
    dims,
    async embed(texts) {
      try {
        const ext = await getExtractor(model);
        const vectors = [];
        for (const text of texts) {
          const output = await ext(text, { pooling: "mean", normalize: true });
          if (output?.data && !output.dims) {
            vectors.push(Float32Array.from(output.data));
          } else if (output?.data) {
            // Already pooled if pooling option worked
            const hidden = output.dims?.[output.dims.length - 1] ?? dims;
            if (output.dims?.length === 2 || output.dims?.length === 1) {
              vectors.push(Float32Array.from(output.data).slice(0, hidden));
            } else {
              vectors.push(meanPool(output));
            }
          } else {
            vectors.push(fallback.embedSync([text])[0]);
          }
        }
        return vectors;
      } catch {
        return fallback.embed(texts);
      }
    },
    embedSync(texts) {
      // Sync path cannot load transformers — hash fallback (same dims).
      return fallback.embedSync(texts);
    },
  };
}
