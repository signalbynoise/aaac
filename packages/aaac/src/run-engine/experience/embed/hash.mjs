/**
 * Deterministic hash embeddings — sync, offline, no model download.
 * Used for stub/CI and as fallback when local/remote providers fail.
 */
import { createHash } from "crypto";

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_./+-]+/)
    .filter((t) => t.length > 0);
}

function hashToken(token, dims) {
  const buf = createHash("sha256").update(token).digest();
  const out = new Float32Array(dims);
  for (let i = 0; i < dims; i += 1) {
    const b = buf[i % buf.length];
    out[i] = (b / 255) * 2 - 1;
  }
  return out;
}

function l2normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / norm;
  return out;
}

/**
 * @param {string} text
 * @param {number} dims
 * @returns {Float32Array}
 */
export function hashEmbed(text, dims = 384) {
  const tokens = tokenize(text);
  const acc = new Float32Array(dims);
  if (!tokens.length) {
    acc[0] = 1;
    return acc;
  }
  for (const token of tokens) {
    const h = hashToken(token, dims);
    for (let i = 0; i < dims; i += 1) acc[i] += h[i];
  }
  return l2normalize(acc);
}

/**
 * @param {string[]} texts
 * @param {number} dims
 * @returns {Float32Array[]}
 */
export function hashEmbedBatch(texts, dims = 384) {
  return texts.map((t) => hashEmbed(t, dims));
}

export function createHashProvider(dims = 384) {
  return {
    id: "hash",
    model: "sha256-bag-of-tokens",
    dims,
    async embed(texts) {
      return hashEmbedBatch(texts, dims);
    },
    embedSync(texts) {
      return hashEmbedBatch(texts, dims);
    },
  };
}
