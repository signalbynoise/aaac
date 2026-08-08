/**
 * Experience index metadata store (SQLite with JSON fallback).
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { tryRequireDep } from "../deps.mjs";
import {
  EXPERIENCE_INDEX_DIR,
  EXPERIENCE_INDEX_DB_PATH,
  EXPERIENCE_INDEX_JSON_PATH,
  VECTOR_SLOTS,
} from "../paths.mjs";

const SCHEMA_VERSION = "1";

function ensureDir() {
  fs.mkdirSync(EXPERIENCE_INDEX_DIR, { recursive: true });
}

export function contentHash(text) {
  return createHash("sha256").update(String(text ?? "")).digest("hex").slice(0, 16);
}

function emptyJsonStore() {
  return {
    version: SCHEMA_VERSION,
    meta: {},
    lesson_vectors: [],
    edges: [],
  };
}

function loadJsonStore() {
  ensureDir();
  if (!fs.existsSync(EXPERIENCE_INDEX_JSON_PATH)) return emptyJsonStore();
  try {
    return { ...emptyJsonStore(), ...JSON.parse(fs.readFileSync(EXPERIENCE_INDEX_JSON_PATH, "utf8")) };
  } catch {
    return emptyJsonStore();
  }
}

function saveJsonStore(store) {
  ensureDir();
  fs.writeFileSync(EXPERIENCE_INDEX_JSON_PATH, JSON.stringify(store, null, 2));
}

function openSqlite() {
  let Database;
  try {
    Database = tryRequireDep("better-sqlite3");
  } catch {
    return null;
  }
  if (!Database) return null;
  try {
    ensureDir();
    const db = new Database(EXPERIENCE_INDEX_DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS index_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lesson_vectors (
        lesson_id TEXT NOT NULL,
        slot TEXT NOT NULL,
        text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        dims INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        vector_key INTEGER,
        PRIMARY KEY (lesson_id, slot)
      );
      CREATE TABLE IF NOT EXISTS edges (
        src_id TEXT NOT NULL,
        dst_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (src_id, dst_id, type)
      );
    `);
    return db;
  } catch {
    // Native bindings missing / corrupt — JSON fallback
    return null;
  }
}

/**
 * @returns {{
 *   backend: 'sqlite'|'json',
 *   getMeta: (key: string) => string|null,
 *   setMeta: (key: string, value: string) => void,
 *   upsertVectorRow: (row: object) => void,
 *   getVectorRows: (lessonId?: string) => object[],
 *   deleteLessonVectors: (lessonId: string) => void,
 *   upsertEdge: (src: string, dst: string, type: string, weight?: number) => void,
 *   getEdges: (srcId?: string) => object[],
 *   clearAll: () => void,
 *   close: () => void,
 * }}
 */
export function openIndexStore() {
  const db = openSqlite();
  if (db) {
    return {
      backend: "sqlite",
      getMeta(key) {
        const row = db.prepare("SELECT value FROM index_meta WHERE key = ?").get(key);
        return row?.value ?? null;
      },
      setMeta(key, value) {
        db.prepare(
          "INSERT INTO index_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ).run(key, String(value));
      },
      upsertVectorRow(row) {
        db.prepare(`
          INSERT INTO lesson_vectors(lesson_id, slot, text, content_hash, dims, provider, model, vector_key)
          VALUES (@lesson_id, @slot, @text, @content_hash, @dims, @provider, @model, @vector_key)
          ON CONFLICT(lesson_id, slot) DO UPDATE SET
            text = excluded.text,
            content_hash = excluded.content_hash,
            dims = excluded.dims,
            provider = excluded.provider,
            model = excluded.model,
            vector_key = excluded.vector_key
        `).run(row);
      },
      getVectorRows(lessonId) {
        if (lessonId) {
          return db
            .prepare("SELECT * FROM lesson_vectors WHERE lesson_id = ?")
            .all(lessonId);
        }
        return db.prepare("SELECT * FROM lesson_vectors").all();
      },
      deleteLessonVectors(lessonId) {
        db.prepare("DELETE FROM lesson_vectors WHERE lesson_id = ?").run(lessonId);
      },
      upsertEdge(src, dst, type, weight = 1) {
        db.prepare(`
          INSERT INTO edges(src_id, dst_id, type, weight)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(src_id, dst_id, type) DO UPDATE SET weight = excluded.weight
        `).run(src, dst, type, weight);
      },
      getEdges(srcId) {
        if (srcId) {
          return db.prepare("SELECT * FROM edges WHERE src_id = ?").all(srcId);
        }
        return db.prepare("SELECT * FROM edges").all();
      },
      clearAll() {
        db.exec("DELETE FROM lesson_vectors; DELETE FROM edges; DELETE FROM index_meta;");
      },
      close() {
        db.close();
      },
    };
  }

  // JSON fallback
  let store = loadJsonStore();
  const persist = () => saveJsonStore(store);
  return {
    backend: "json",
    getMeta(key) {
      return store.meta[key] ?? null;
    },
    setMeta(key, value) {
      store.meta[key] = String(value);
      persist();
    },
    upsertVectorRow(row) {
      store.lesson_vectors = store.lesson_vectors.filter(
        (r) => !(r.lesson_id === row.lesson_id && r.slot === row.slot),
      );
      store.lesson_vectors.push({ ...row });
      persist();
    },
    getVectorRows(lessonId) {
      if (lessonId) {
        return store.lesson_vectors.filter((r) => r.lesson_id === lessonId);
      }
      return [...store.lesson_vectors];
    },
    deleteLessonVectors(lessonId) {
      store.lesson_vectors = store.lesson_vectors.filter((r) => r.lesson_id !== lessonId);
      persist();
    },
    upsertEdge(src, dst, type, weight = 1) {
      store.edges = store.edges.filter(
        (e) => !(e.src_id === src && e.dst_id === dst && e.type === type),
      );
      store.edges.push({ src_id: src, dst_id: dst, type, weight });
      persist();
    },
    getEdges(srcId) {
      if (srcId) return store.edges.filter((e) => e.src_id === srcId);
      return [...store.edges];
    },
    clearAll() {
      store = emptyJsonStore();
      persist();
    },
    close() {},
  };
}

export function slotKey(lessonId, slot) {
  return `${lessonId}#${slot}`;
}

export function parseSlotKey(key) {
  const idx = String(key).lastIndexOf("#");
  if (idx < 0) return { lessonId: key, slot: "meaning" };
  return { lessonId: key.slice(0, idx), slot: key.slice(idx + 1) };
}

/** Stable numeric key for HNSW from lesson_id#slot */
export function numericKeyForSlot(lessonId, slot) {
  const hex = createHash("sha256")
    .update(slotKey(lessonId, slot))
    .digest()
    .readUInt32BE(0);
  return hex >>> 0;
}

export { VECTOR_SLOTS, SCHEMA_VERSION, EXPERIENCE_INDEX_DIR };
