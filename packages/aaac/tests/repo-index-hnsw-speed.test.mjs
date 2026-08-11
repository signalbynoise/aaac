/**
 * Repo-memory dense search: HNSW (usearch) vs brute-force cosine.
 * Verifies correctness overlap and reports wall-clock speedup.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const EXP = path.join(PACKAGE_ROOT, 'src/run-engine/experience');
const TEMPLATE_RETRIEVAL_YAML = path.join(
  PACKAGE_ROOT,
  'templates/cursor/aaac/experience/retrieval.yaml',
);

function hashVec(text, dims = 384) {
  const out = new Float32Array(dims);
  const digest = createHash('sha256').update(String(text)).digest();
  for (let i = 0; i < dims; i += 1) {
    out[i] = ((digest[i % digest.length] / 255) * 2 - 1) * (1 + ((i * 17) % 7) / 10);
  }
  // L2 normalize
  let n = 0;
  for (let i = 0; i < dims; i += 1) n += out[i] * out[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dims; i += 1) out[i] /= n;
  return Array.from(out);
}

function buildSyntheticStore({ count = 8000, dims = 384, slots = ['summary'] } = {}) {
  const entries = {};
  for (let i = 0; i < count; i += 1) {
    const nodeId = `file:synth/module-${i}.ts`;
    for (const slot of slots) {
      entries[`${nodeId}::${slot}`] = hashVec(`${nodeId}:${slot}:${i}`, dims);
    }
  }
  return { dims, entries };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function timeSearch(searchFn, queries, k, slot, backend, rounds = 3) {
  // warmup
  for (let i = 0; i < Math.min(5, queries.length); i += 1) {
    searchFn(queries[i], { k, slot, backend });
  }
  const samples = [];
  for (let r = 0; r < rounds; r += 1) {
    const t0 = performance.now();
    for (const q of queries) {
      searchFn(q, { k, slot, backend });
    }
    samples.push(performance.now() - t0);
  }
  return {
    total_ms: median(samples),
    per_query_ms: median(samples) / queries.length,
  };
}

describe('repo-index HNSW speed', () => {
  let tmp;
  let prevRoot;
  let prevProvider;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaac-repo-hnsw-'));
    prevRoot = process.env.AAAC_WORKSPACE_ROOT;
    prevProvider = process.env.AAAC_EMBEDDING_PROVIDER;
    process.env.AAAC_WORKSPACE_ROOT = tmp;
    process.env.AAAC_EMBEDDING_PROVIDER = 'hash';

    const aaac = path.join(tmp, '.cursor', 'aaac');
    fs.mkdirSync(path.join(aaac, 'state', 'repo-index'), { recursive: true });
    fs.mkdirSync(path.join(aaac, 'experience'), { recursive: true });
    fs.writeFileSync(
      path.join(aaac, 'experience', 'retrieval.yaml'),
      fs.readFileSync(TEMPLATE_RETRIEVAL_YAML, 'utf8'),
    );
    vi.resetModules();
  });

  afterEach(async () => {
    const { resetRepoVectorIndexCache } = await import(
      path.join(EXP, 'repo-index/hnsw.mjs')
    );
    resetRepoVectorIndexCache();
    if (prevRoot === undefined) delete process.env.AAAC_WORKSPACE_ROOT;
    else process.env.AAAC_WORKSPACE_ROOT = prevRoot;
    if (prevProvider === undefined) delete process.env.AAAC_EMBEDDING_PROVIDER;
    else process.env.AAAC_EMBEDDING_PROVIDER = prevProvider;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('uses usearch HNSW when available and matches brute top-k on real-shaped data', async () => {
    const { replaceRepoVectorIndex, getRepoVectorIndex } = await import(
      path.join(EXP, 'repo-index/hnsw.mjs')
    );
    const { searchRepoVectors } = await import(path.join(EXP, 'repo-index/build.mjs'));

    const store = buildSyntheticStore({ count: 400, dims: 384, slots: ['summary'] });
    fs.writeFileSync(
      path.join(tmp, '.cursor/aaac/state/repo-index/vectors.json'),
      JSON.stringify(store),
    );

    const hnsw = replaceRepoVectorIndex(store, { backend: 'auto', persist: true });
    expect(['usearch', 'brute']).toContain(hnsw.backend);

    const brute = getRepoVectorIndex({ backend: 'brute', force: true });
    expect(brute.backend).toBe('brute');
    expect(brute.size()).toBe(400);

    const query = hashVec('architecture check ephemeris domain');
    const exact = searchRepoVectors(query, { k: 12, slot: 'summary', backend: 'brute' });
    const approx = searchRepoVectors(query, { k: 12, slot: 'summary', backend: 'auto' });

    expect(exact).toHaveLength(12);
    expect(approx).toHaveLength(12);

    const exactIds = new Set(exact.map((h) => h.nodeId));
    const overlap = approx.filter((h) => exactIds.has(h.nodeId)).length;
    // HNSW should recover most of the exact top-12 on this corpus size
    expect(overlap).toBeGreaterThanOrEqual(9);
  });

  it('is faster than brute-force at scale (reports speedup)', async () => {
    const { replaceRepoVectorIndex, getRepoVectorIndex } = await import(
      path.join(EXP, 'repo-index/hnsw.mjs')
    );
    const { searchRepoVectors } = await import(path.join(EXP, 'repo-index/build.mjs'));

    const COUNT = 12000;
    const store = buildSyntheticStore({ count: COUNT, dims: 384, slots: ['summary'] });
    fs.writeFileSync(
      path.join(tmp, '.cursor/aaac/state/repo-index/vectors.json'),
      JSON.stringify(store),
    );

    const hnsw = replaceRepoVectorIndex(store, { backend: 'auto', persist: true });
    const brute = getRepoVectorIndex({ backend: 'brute', force: true });

    if (hnsw.backend !== 'usearch') {
      console.warn('[repo-hnsw-speed] usearch unavailable — skipping speed assertion');
      expect(brute.backend).toBe('brute');
      return;
    }

    const queries = Array.from({ length: 40 }, (_, i) =>
      hashVec(`query-architecture-boundary-${i}`),
    );
    const k = 32;

    const bruteTiming = timeSearch(searchRepoVectors, queries, k, 'summary', 'brute', 3);
    const hnswTiming = timeSearch(searchRepoVectors, queries, k, 'summary', 'auto', 3);
    const speedup = bruteTiming.total_ms / Math.max(hnswTiming.total_ms, 0.001);

    console.log(
      JSON.stringify(
        {
          backend_hnsw: hnsw.backend,
          vectors: COUNT,
          queries: queries.length,
          k,
          brute_total_ms: Number(bruteTiming.total_ms.toFixed(2)),
          hnsw_total_ms: Number(hnswTiming.total_ms.toFixed(2)),
          brute_per_query_ms: Number(bruteTiming.per_query_ms.toFixed(3)),
          hnsw_per_query_ms: Number(hnswTiming.per_query_ms.toFixed(3)),
          speedup: Number(speedup.toFixed(2)),
        },
        null,
        2,
      ),
    );

    expect(speedup).toBeGreaterThan(2);
    expect(hnswTiming.per_query_ms).toBeLessThan(bruteTiming.per_query_ms);
  });

  it('benchmarks against astro repo-index when present', async () => {
    const astroVectors = '/Users/eriklydecker/astro/.cursor/aaac/state/repo-index/vectors.json';
    if (!fs.existsSync(astroVectors)) {
      console.warn('[repo-hnsw-speed] no astro vectors.json — skip live corpus bench');
      return;
    }

    const store = JSON.parse(fs.readFileSync(astroVectors, 'utf8'));
    const summaryCount = Object.keys(store.entries ?? {}).filter((k) =>
      k.endsWith('::summary'),
    ).length;
    if (summaryCount < 50) {
      console.warn('[repo-hnsw-speed] astro corpus too small — skip');
      return;
    }

    fs.writeFileSync(
      path.join(tmp, '.cursor/aaac/state/repo-index/vectors.json'),
      JSON.stringify(store),
    );

    const { replaceRepoVectorIndex } = await import(path.join(EXP, 'repo-index/hnsw.mjs'));
    const { searchRepoVectors } = await import(path.join(EXP, 'repo-index/build.mjs'));

    const hnsw = replaceRepoVectorIndex(store, { backend: 'auto', persist: true });
    const queries = Array.from({ length: 30 }, (_, i) =>
      hashVec(`astro-check-architecture-${i}`),
    );
    const bruteTiming = timeSearch(searchRepoVectors, queries, 12, 'summary', 'brute', 3);
    const hnswTiming = timeSearch(searchRepoVectors, queries, 12, 'summary', 'auto', 3);
    const speedup = bruteTiming.total_ms / Math.max(hnswTiming.total_ms, 0.001);

    console.log(
      JSON.stringify(
        {
          corpus: 'astro',
          backend_hnsw: hnsw.backend,
          summary_vectors: summaryCount,
          queries: queries.length,
          brute_total_ms: Number(bruteTiming.total_ms.toFixed(2)),
          hnsw_total_ms: Number(hnswTiming.total_ms.toFixed(2)),
          brute_per_query_ms: Number(bruteTiming.per_query_ms.toFixed(3)),
          hnsw_per_query_ms: Number(hnswTiming.per_query_ms.toFixed(3)),
          speedup: Number(speedup.toFixed(2)),
        },
        null,
        2,
      ),
    );

    if (hnsw.backend !== 'usearch') {
      console.warn('[repo-hnsw-speed] usearch unavailable for astro corpus bench');
      return;
    }
    // Small corpuses may not show large speedups; still must not regress badly.
    expect(hnswTiming.total_ms).toBeLessThan(bruteTiming.total_ms * 1.5);
  });
});
