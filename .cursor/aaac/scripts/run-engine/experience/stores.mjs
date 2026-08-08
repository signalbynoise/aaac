/**
 * Load/save experience stores (lessons, stats, memory, packaged corpus).
 */
import { readJson, writeJson, isoNow } from "../lib.mjs";
import {
  LESSONS_PATH,
  EXPERIENCE_STATS_PATH,
  WORKSPACE_MEMORY_PATH,
  GLOBAL_LESSONS_PATH,
} from "./paths.mjs";

export function emptyLessonsStore() {
  return { version: 1, updated_at: null, lessons: {} };
}

export function emptyStatsStore() {
  return { version: 1, updated_at: null, signatures: {} };
}

export function emptyMemoryStore() {
  return { version: 1, updated_at: null, prefs: [] };
}

export function loadLessonsStore() {
  return readJson(LESSONS_PATH, emptyLessonsStore());
}

export function saveLessonsStore(store) {
  store.updated_at = isoNow();
  writeJson(LESSONS_PATH, store);
}

export function loadExperienceStats() {
  return readJson(EXPERIENCE_STATS_PATH, emptyStatsStore());
}

export function saveExperienceStats(store) {
  store.updated_at = isoNow();
  writeJson(EXPERIENCE_STATS_PATH, store);
}

export function loadWorkspaceMemory() {
  return readJson(WORKSPACE_MEMORY_PATH, emptyMemoryStore());
}

export function saveWorkspaceMemory(store) {
  store.updated_at = isoNow();
  writeJson(WORKSPACE_MEMORY_PATH, store);
}

export function loadPackagedGlobalLessons() {
  return readJson(GLOBAL_LESSONS_PATH, emptyLessonsStore());
}

/** Local lessons win on id collision. Active-only. */
export function mergeLessonCorpora(packaged, local) {
  const merged = {};
  for (const [id, lesson] of Object.entries(packaged?.lessons ?? {})) {
    if (lesson?.status && lesson.status !== "active") continue;
    merged[id] = { ...lesson, source: "packaged" };
  }
  for (const [id, lesson] of Object.entries(local?.lessons ?? {})) {
    if (lesson?.status && lesson.status !== "active") continue;
    merged[id] = { ...lesson, source: "local" };
  }
  return merged;
}
