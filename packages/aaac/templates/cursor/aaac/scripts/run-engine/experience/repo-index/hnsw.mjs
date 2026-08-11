/**
 * V6 — HNSW (usearch) index for repository node embeddings.
 * Portable SSOT remains vectors.json; usearch is a derived speed layer.
 */
import fs from "fs";
import { createHash } from "crypto";
import { tryRequireDep } from "../deps.mjs";
import {
  REPO_INDEX_DIR,
  REPO_INDEX_VECTORS_PATH,
  REPO_INDEX_HNSW_PATH,
  loadRetrievalConfig,
} from "../paths.mjs";

function ensureDir() {
  fs.mkdirSync(REPO_INDEX_DIR, { recursive: true });
}

export function repoSlotKey(nodeId, slot) {
  return `${nodeId}::${slot}`;
}

export function parseRepoSlotKey(key) {
  const idx = String(key).lastIndexOf("::");
  if (idx < 0) return { nodeId: key, slot: "summary" };
  return { nodeId: key.slice(0, idx), slot: key.slice(idx + 2) };
}

/** Stable uint32 key for usearch from nodeId::slot */
export function numericKeyForRepoSlot(nodeId, slot) {
  const hex = createHash("sha256")
    .update(repoSlotKey(nodeId, slot))
    .digest()
    .readUInt32BE(0);
  return hex >>> 0;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a?.length ?? 0, b?.length ?? 0);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function loadVectorsJson() {
  ensureDir();
  if (!fs.existsSync(REPO_INDEX_VECTORS_PATH)) {
    return { dims: 384, entries: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(REPO_INDEX_VECTORS_PATH, "utf8"));
  } catch {
    return { dims: 384, entries: {} };
  }
}

/**
 * Brute-force cosine over in-memory entries (always available).
 */
function createBruteIndex(dims) {
  /** @type {Map<number, { key: string, nodeId: string, slot: string, vector: Float32Array }>} */
  const byNum = new Map();
  /** @type {Map<string, number>} */
  const keyToNum = new Map();

  return {
    backend: "brute",
    dims,
    size() {
      return byNum.size;
    },
    upsert(nodeId, slot, vector) {
      const key = repoSlotKey(nodeId, slot);
      const num = numericKeyForRepoSlot(nodeId, slot);
      const prev = keyToNum.get(key);
      if (prev !== undefined) byNum.delete(prev);
      keyToNum.set(key, num);
      byNum.set(num, {
        key,
        nodeId,
        slot,
        vector: Float32Array.from(vector),
      });
    },
    remove(nodeId, slot) {
      const key = repoSlotKey(nodeId, slot);
      const num = keyToNum.get(key);
      if (num !== undefined) {
        byNum.delete(num);
        keyToNum.delete(key);
      }
    },
    search(query, k, { slot = null } = {}) {
      const scored = [];
      for (const [num, entry] of byNum) {
        if (slot && entry.slot !== slot) continue;
        scored.push({
          numericKey: num,
          key: entry.key,
          nodeId: entry.nodeId,
          slot: entry.slot,
          score: cosine(query, entry.vector),
          vector: entry.vector,
        });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    },
    getVector(nodeId, slot) {
      const num = keyToNum.get(repoSlotKey(nodeId, slot));
      return num !== undefined ? byNum.get(num)?.vector ?? null : null;
    },
    saveJson(store) {
      ensureDir();
      const entries = {};
      for (const entry of byNum.values()) {
        entries[entry.key] = Array.from(entry.vector);
      }
      const payload = { dims, entries, ...(store?.provider ? { provider: store.provider } : {}) };
      fs.writeFileSync(REPO_INDEX_VECTORS_PATH, JSON.stringify(payload));
    },
    loadFromJson(payload) {
      byNum.clear();
      keyToNum.clear();
      for (const [key, vector] of Object.entries(payload?.entries ?? {})) {
        const { nodeId, slot } = parseRepoSlotKey(key);
        this.upsert(nodeId, slot, vector);
      }
    },
    clear() {
      byNum.clear();
      keyToNum.clear();
    },
  };
}

/**
 * usearch HNSW + brute mirror for getVector / slot filtering / fallback.
 */
function createUsearchIndex(dims, connectivity) {
  const usearch = tryRequireDep("usearch");
  if (!usearch?.Index) return null;

  const brute = createBruteIndex(dims);
  /** @type {Map<number, { key: string, nodeId: string, slot: string, vector: Float32Array }>} */
  const byNum = new Map();

  let index = new usearch.Index({
    metric: "cos",
    connectivity,
    dimensions: dims,
  });

  function rebuildUsearchFromBrute() {
    index = new usearch.Index({
      metric: "cos",
      connectivity,
      dimensions: dims,
    });
    byNum.clear();
    // Re-walk via a full search of identity is awkward; keep parallel map on upsert.
  }

  return {
    backend: "usearch",
    dims,
    size() {
      return brute.size();
    },
    upsert(nodeId, slot, vector) {
      const num = numericKeyForRepoSlot(nodeId, slot);
      const vec = Float32Array.from(vector);
      const key = repoSlotKey(nodeId, slot);
      try {
        index.remove(BigInt(num));
      } catch {
        // not present
      }
      index.add(BigInt(num), vec);
      byNum.set(num, { key, nodeId, slot, vector: vec });
      brute.upsert(nodeId, slot, vec);
    },
    remove(nodeId, slot) {
      const num = numericKeyForRepoSlot(nodeId, slot);
      try {
        index.remove(BigInt(num));
      } catch {
        // ignore
      }
      byNum.delete(num);
      brute.remove(nodeId, slot);
    },
    search(query, k, { slot = null } = {}) {
      if (brute.size() === 0) return [];
      const want = Math.max(1, k);
      // Over-fetch when filtering by slot (4 slots share one index).
      const fetch = slot
        ? Math.min(brute.size(), Math.max(want * 8, want))
        : Math.min(brute.size(), want);
      try {
        const q = Float32Array.from(query);
        const results = index.search(q, fetch);
        const keys = results.keys ?? results;
        const distances = results.distances ?? [];
        const out = [];
        for (let i = 0; i < keys.length; i += 1) {
          const num = Number(keys[i]);
          const entry = byNum.get(num);
          if (!entry) continue;
          if (slot && entry.slot !== slot) continue;
          const dist = distances[i];
          const score =
            typeof dist === "number" ? Math.max(0, 1 - dist) : cosine(q, entry.vector);
          out.push({
            numericKey: num,
            key: entry.key,
            nodeId: entry.nodeId,
            slot: entry.slot,
            score,
            vector: entry.vector,
          });
          if (out.length >= want) break;
        }
        if (out.length >= want || !slot) {
          out.sort((a, b) => b.score - a.score);
          return out.slice(0, want);
        }
        // Slot filter under-filled — exact fallback for correctness.
      } catch {
        // fall through
      }
      return brute.search(query, want, { slot });
    },
    getVector(nodeId, slot) {
      return brute.getVector(nodeId, slot);
    },
    saveJson(store) {
      ensureDir();
      try {
        index.save(REPO_INDEX_HNSW_PATH);
      } catch {
        // native save optional
      }
      brute.saveJson(store);
    },
    loadFromJson(payload) {
      brute.loadFromJson(payload);
      rebuildUsearchFromBrute();
      byNum.clear();
      for (const [key, vector] of Object.entries(payload?.entries ?? {})) {
        const { nodeId, slot } = parseRepoSlotKey(key);
        const num = numericKeyForRepoSlot(nodeId, slot);
        const vec = Float32Array.from(vector);
        index.add(BigInt(num), vec);
        byNum.set(num, { key, nodeId, slot, vector: vec });
        // brute already loaded
      }
    },
    clear() {
      index = new usearch.Index({
        metric: "cos",
        connectivity,
        dimensions: dims,
      });
      byNum.clear();
      brute.clear();
    },
  };
}

/** @type {Map<string, ReturnType<typeof createBruteIndex>>} */
const cache = new Map();

/**
 * @param {{ dims?: number, force?: boolean, backend?: "usearch"|"brute"|"auto", load?: boolean }} [options]
 */
export function getRepoVectorIndex(options = {}) {
  const cfg = loadRetrievalConfig();
  const dimsHint = options.dims ?? cfg.hnsw.dimensions ?? 384;
  const wantBrute = options.backend === "brute";
  // Cache key must not depend on parsing vectors.json (that is expensive).
  const cacheKey = `${wantBrute ? "brute" : "hnsw"}:${dimsHint}`;

  if (!options.force && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  // Also accept a previously-built index at a different dims hint once loaded.
  if (!options.force) {
    for (const [key, index] of cache) {
      if (key.startsWith(wantBrute ? "brute:" : "hnsw:") && index.size() > 0) {
        return index;
      }
    }
  }

  const payload = options.load === false ? null : loadVectorsJson();
  const dims = options.dims ?? payload?.dims ?? dimsHint;

  let index = null;
  if (!wantBrute) {
    index = createUsearchIndex(dims, cfg.hnsw.connectivity);
  }
  if (!index) {
    index = createBruteIndex(dims);
  }

  if (options.load !== false) {
    index.loadFromJson(payload ?? { dims, entries: {} });
  }
  cache.set(`${wantBrute ? "brute" : "hnsw"}:${dims}`, index);
  return index;
}

export function resetRepoVectorIndexCache() {
  cache.clear();
}

/**
 * Replace index contents from a vectors.json-shaped store and persist.
 */
export function replaceRepoVectorIndex(store, options = {}) {
  const dims = store?.dims ?? options.dims ?? 384;
  resetRepoVectorIndexCache();
  const index = getRepoVectorIndex({
    dims,
    force: true,
    backend: options.backend,
    load: false,
  });
  index.clear();
  index.loadFromJson(store);
  if (options.persist !== false) {
    index.saveJson(store);
  }
  const cacheKey = `${dims}:${options.backend === "brute" ? "brute" : "hnsw"}`;
  cache.set(cacheKey, index);
  return index;
}
