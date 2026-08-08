/**
 * Build / upsert experience vector index from lesson corpora.
 */
import fs from "fs";
import { getEmbeddingProvider } from "../embed/provider.mjs";
import { deriveLessonSlotTexts } from "../lesson-texts.mjs";
import {
  VECTOR_SLOTS,
  loadRetrievalConfig,
  PACKAGED_INDEX_DIR,
  PACKAGED_INDEX_META_PATH,
  PACKAGED_INDEX_VECTORS_PATH,
} from "../paths.mjs";
import { contentHash, openIndexStore, SCHEMA_VERSION, numericKeyForSlot, slotKey } from "./store.mjs";
import { getVectorIndex, resetVectorIndexCache, cosine } from "./hnsw.mjs";

/**
 * @param {Record<string, object>} lessons
 * @param {{ provider?: object, force?: boolean, lessonIds?: string[] }} [options]
 */
export async function upsertLessonsIntoIndex(lessons, options = {}) {
  const cfg = loadRetrievalConfig();
  const provider = options.provider ?? getEmbeddingProvider(options);
  const store = openIndexStore();
  const index = getVectorIndex({ dims: provider.dims, force: options.force });

  const ids = options.lessonIds ?? Object.keys(lessons);
  let upserted = 0;
  let skipped = 0;

  try {
    for (const id of ids) {
      const lesson = lessons[id];
      if (!lesson?.evidence) continue;
      const slots = deriveLessonSlotTexts(lesson);
      const texts = VECTOR_SLOTS.map((s) => slots[s]);
      const hashes = texts.map((t) => contentHash(t));

      const existing = store.getVectorRows(id);
      const bySlot = Object.fromEntries(existing.map((r) => [r.slot, r]));
      const needsEmbed = VECTOR_SLOTS.some((slot, i) => {
        const row = bySlot[slot];
        return (
          options.force ||
          !row ||
          row.content_hash !== hashes[i] ||
          row.provider !== provider.id ||
          row.model !== provider.model
        );
      });

      if (!needsEmbed) {
        skipped += 1;
        continue;
      }

      const vectors = await provider.embed(texts);
      for (let i = 0; i < VECTOR_SLOTS.length; i += 1) {
        const slot = VECTOR_SLOTS[i];
        index.upsert(id, slot, vectors[i]);
        store.upsertVectorRow({
          lesson_id: id,
          slot,
          text: texts[i],
          content_hash: hashes[i],
          dims: provider.dims,
          provider: provider.id,
          model: provider.model,
          vector_key: null,
        });
      }

      // Structural edges from tags / command
      for (const tag of lesson.tags ?? []) {
        store.upsertEdge(id, `tag:${tag}`, "APPLIES_TO_COMMAND", 0.8);
      }
      if (lesson.contradicts) {
        for (const other of lesson.contradicts) {
          store.upsertEdge(id, other, "CONTRADICTS", 1);
          store.upsertEdge(other, id, "CONTRADICTS", 1);
        }
      }
      if (lesson.supersedes) {
        store.upsertEdge(id, lesson.supersedes, "SUPERSEDES", 1);
      }

      upserted += 1;
    }

    // SIMILAR_TO edges from meaning-neighbour search (bounded)
    for (const id of ids) {
      const meaningVec = index.getVector(id, "meaning");
      if (!meaningVec) continue;
      const neighbours = index.search(meaningVec, cfg.max_neighbours_per_seed + 1);
      let added = 0;
      for (const n of neighbours) {
        if (n.lessonId === id) continue;
        store.upsertEdge(id, n.lessonId, "SIMILAR_TO", n.score);
        added += 1;
        if (added >= cfg.max_neighbours_per_seed) break;
      }
    }

    store.setMeta("schema_version", SCHEMA_VERSION);
    store.setMeta("provider", provider.id);
    store.setMeta("model", provider.model);
    store.setMeta("dims", String(provider.dims));
    store.setMeta("built_at", new Date().toISOString());
    index.save();

    return {
      ok: true,
      upserted,
      skipped,
      backend: `${store.backend}+${index.backend}`,
      provider: provider.id,
      model: provider.model,
    };
  } finally {
    store.close();
  }
}

/**
 * Full rebuild from merged corpora.
 * @param {Record<string, object>} lessons
 * @param {{ provider?: object }} [options]
 */
export async function rebuildExperienceIndex(lessons, options = {}) {
  const store = openIndexStore();
  store.clearAll();
  store.close();
  resetVectorIndexCache();
  const index = getVectorIndex({ force: true });
  index.clear();
  return upsertLessonsIntoIndex(lessons, { ...options, force: true });
}

/**
 * Write portable packaged-index (JSON) for npm ships — no sqlite/usearch required.
 * Uses hash provider by default so installs retrieve offline.
 *
 * @param {Record<string, object>} lessons
 * @param {{ provider?: object }} [options]
 */
export async function writePackagedExperienceIndex(lessons, options = {}) {
  const cfg = loadRetrievalConfig();
  const provider =
    options.provider ??
    getEmbeddingProvider({
      provider: cfg.embedding.packaged_provider || "hash",
      force: true,
    });

  const lesson_vectors = [];
  const edges = [];
  /** @type {Map<string, Float32Array>} */
  const meaningById = new Map();
  const vectorEntries = [];

  for (const [id, lesson] of Object.entries(lessons)) {
    if (!lesson?.evidence) continue;
    if (lesson.status && lesson.status !== "active") continue;
    const slots = deriveLessonSlotTexts(lesson);
    const texts = VECTOR_SLOTS.map((s) => slots[s]);
    const vectors = await provider.embed(texts);
    for (let i = 0; i < VECTOR_SLOTS.length; i += 1) {
      const slot = VECTOR_SLOTS[i];
      const key = slotKey(id, slot);
      vectorEntries.push({ key, vector: Array.from(vectors[i]) });
      lesson_vectors.push({
        lesson_id: id,
        slot,
        text: texts[i],
        content_hash: contentHash(texts[i]),
        dims: provider.dims,
        provider: provider.id,
        model: provider.model,
        vector_key: numericKeyForSlot(id, slot),
      });
      if (slot === "meaning") meaningById.set(id, vectors[i]);
    }
    for (const tag of lesson.tags ?? []) {
      edges.push({
        src_id: id,
        dst_id: `tag:${tag}`,
        type: "APPLIES_TO_COMMAND",
        weight: 0.8,
      });
    }
  }

  // SIMILAR_TO among packaged lessons
  const ids = [...meaningById.keys()];
  for (const id of ids) {
    const vec = meaningById.get(id);
    const scored = ids
      .filter((other) => other !== id)
      .map((other) => ({
        other,
        score: cosine(vec, meaningById.get(other)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.max_neighbours_per_seed);
    for (const n of scored) {
      edges.push({
        src_id: id,
        dst_id: n.other,
        type: "SIMILAR_TO",
        weight: n.score,
      });
    }
  }

  fs.mkdirSync(PACKAGED_INDEX_DIR, { recursive: true });
  const meta = {
    version: SCHEMA_VERSION,
    meta: {
      schema_version: SCHEMA_VERSION,
      provider: provider.id,
      model: provider.model,
      dims: String(provider.dims),
      built_at: new Date().toISOString(),
      packaged: "true",
    },
    lesson_vectors,
    edges,
  };
  fs.writeFileSync(PACKAGED_INDEX_META_PATH, JSON.stringify(meta, null, 2));
  fs.writeFileSync(
    PACKAGED_INDEX_VECTORS_PATH,
    JSON.stringify({ dims: provider.dims, entries: vectorEntries }),
  );

  return {
    ok: true,
    lessons: ids.length,
    vectors: vectorEntries.length,
    provider: provider.id,
    model: provider.model,
    paths: {
      meta: PACKAGED_INDEX_META_PATH,
      vectors: PACKAGED_INDEX_VECTORS_PATH,
    },
  };
}
