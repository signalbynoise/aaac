/**
 * HNSW vector index via usearch, with in-memory brute-force JSON fallback.
 */
import fs from "fs";
import { tryRequireDep } from "../deps.mjs";
import {
  EXPERIENCE_HNSW_PATH,
  EXPERIENCE_VECTORS_JSON_PATH,
  EXPERIENCE_INDEX_DIR,
  loadRetrievalConfig,
} from "../paths.mjs";
import { numericKeyForSlot, parseSlotKey, slotKey } from "./store.mjs";

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function ensureDir() {
  fs.mkdirSync(EXPERIENCE_INDEX_DIR, { recursive: true });
}

/**
 * Brute-force cosine index (always available).
 */
function createBruteIndex(dims) {
  /** @type {Map<number, { key: string, vector: Float32Array }>} */
  const byNum = new Map();
  /** @type {Map<string, number>} */
  const keyToNum = new Map();

  return {
    backend: "brute",
    dims,
    size() {
      return byNum.size;
    },
    upsert(lessonId, slot, vector) {
      const key = slotKey(lessonId, slot);
      const num = numericKeyForSlot(lessonId, slot);
      const prev = keyToNum.get(key);
      if (prev !== undefined) byNum.delete(prev);
      keyToNum.set(key, num);
      byNum.set(num, { key, vector: Float32Array.from(vector) });
    },
    remove(lessonId, slot) {
      const key = slotKey(lessonId, slot);
      const num = keyToNum.get(key);
      if (num !== undefined) {
        byNum.delete(num);
        keyToNum.delete(key);
      }
    },
    search(query, k) {
      const scored = [];
      for (const [num, entry] of byNum) {
        scored.push({
          numericKey: num,
          key: entry.key,
          ...parseSlotKey(entry.key),
          score: cosine(query, entry.vector),
          vector: entry.vector,
        });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    },
    getVector(lessonId, slot) {
      const num = keyToNum.get(slotKey(lessonId, slot));
      return num !== undefined ? byNum.get(num)?.vector ?? null : null;
    },
    save() {
      ensureDir();
      const payload = {
        dims,
        entries: [...byNum.values()].map((e) => ({
          key: e.key,
          vector: Array.from(e.vector),
        })),
      };
      fs.writeFileSync(EXPERIENCE_VECTORS_JSON_PATH, JSON.stringify(payload));
    },
    load() {
      if (!fs.existsSync(EXPERIENCE_VECTORS_JSON_PATH)) return;
      try {
        const payload = JSON.parse(fs.readFileSync(EXPERIENCE_VECTORS_JSON_PATH, "utf8"));
        byNum.clear();
        keyToNum.clear();
        for (const e of payload.entries ?? []) {
          const { lessonId, slot } = parseSlotKey(e.key);
          this.upsert(lessonId, slot, e.vector);
        }
      } catch {
        // ignore corrupt
      }
    },
    clear() {
      byNum.clear();
      keyToNum.clear();
    },
  };
}

/**
 * usearch-backed index with brute mirror for getVector / persistence fallback.
 */
function createUsearchIndex(dims, connectivity) {
  const usearch = tryRequireDep("usearch");
  if (!usearch?.Index) return null;

  const brute = createBruteIndex(dims);
  let index = new usearch.Index({
    metric: "cos",
    connectivity,
    dimensions: dims,
  });

  return {
    backend: "usearch",
    dims,
    size() {
      return brute.size();
    },
    upsert(lessonId, slot, vector) {
      const num = BigInt(numericKeyForSlot(lessonId, slot));
      const vec = Float32Array.from(vector);
      try {
        index.remove(num);
      } catch {
        // not present
      }
      index.add(num, vec);
      brute.upsert(lessonId, slot, vec);
    },
    remove(lessonId, slot) {
      const num = BigInt(numericKeyForSlot(lessonId, slot));
      try {
        index.remove(num);
      } catch {
        // ignore
      }
      brute.remove(lessonId, slot);
    },
    search(query, k) {
      if (brute.size() === 0) return [];
      try {
        const q = Float32Array.from(query);
        const results = index.search(q, Math.min(k, brute.size()));
        const keys = results.keys ?? results;
        const distances = results.distances ?? [];
        const out = [];
        for (let i = 0; i < keys.length; i += 1) {
          const num = Number(keys[i]);
          const entry = [...brute.search(q, brute.size())].find(
            (r) => r.numericKey === num,
          );
          if (!entry) continue;
          // usearch cos distance → similarity ≈ 1 - distance (approx)
          const dist = distances[i] ?? 0;
          const score = typeof dist === "number" ? Math.max(0, 1 - dist) : entry.score;
          out.push({ ...entry, score });
        }
        if (out.length) {
          out.sort((a, b) => b.score - a.score);
          return out.slice(0, k);
        }
      } catch {
        // fall through
      }
      return brute.search(query, k);
    },
    getVector(lessonId, slot) {
      return brute.getVector(lessonId, slot);
    },
    save() {
      ensureDir();
      try {
        index.save(EXPERIENCE_HNSW_PATH);
      } catch {
        // native save optional
      }
      brute.save();
    },
    load() {
      brute.load();
      if (fs.existsSync(EXPERIENCE_HNSW_PATH)) {
        try {
          index = usearch.Index.restore
            ? usearch.Index.restore(EXPERIENCE_HNSW_PATH)
            : index;
          // Rebuild from brute for consistency after restore API variance
        } catch {
          // rebuild from brute vectors
        }
      }
      // Always rebuild usearch from brute for correctness across versions
      index = new usearch.Index({
        metric: "cos",
        connectivity,
        dimensions: dims,
      });
      const cfg = loadRetrievalConfig();
      void cfg;
      // Re-add from JSON
      if (fs.existsSync(EXPERIENCE_VECTORS_JSON_PATH)) {
        try {
          const payload = JSON.parse(fs.readFileSync(EXPERIENCE_VECTORS_JSON_PATH, "utf8"));
          for (const e of payload.entries ?? []) {
            const { lessonId, slot } = parseSlotKey(e.key);
            const num = BigInt(numericKeyForSlot(lessonId, slot));
            const vec = Float32Array.from(e.vector);
            index.add(num, vec);
            brute.upsert(lessonId, slot, vec);
          }
        } catch {
          // ignore
        }
      }
    },
    clear() {
      index = new usearch.Index({
        metric: "cos",
        connectivity,
        dimensions: dims,
      });
      brute.clear();
    },
  };
}

/** @type {ReturnType<typeof createBruteIndex>|null} */
let singleton = null;

export function getVectorIndex(options = {}) {
  const cfg = loadRetrievalConfig();
  const dims = options.dims ?? cfg.hnsw.dimensions;
  if (singleton && singleton.dims === dims && !options.force) return singleton;

  const usearchIndex = createUsearchIndex(dims, cfg.hnsw.connectivity);
  singleton = usearchIndex ?? createBruteIndex(dims);
  singleton.load();
  return singleton;
}

export function resetVectorIndexCache() {
  singleton = null;
}

export { cosine };
