/**
 * Seed local experience-index from packaged-index (npm collective corpus).
 * Fresh installs get working vector retrieval with zero local rebuild.
 */
import fs from "fs";
import {
  EXPERIENCE_INDEX_DIR,
  EXPERIENCE_INDEX_JSON_PATH,
  EXPERIENCE_VECTORS_JSON_PATH,
  PACKAGED_INDEX_META_PATH,
  PACKAGED_INDEX_VECTORS_PATH,
} from "../paths.mjs";
import { resetVectorIndexCache } from "./hnsw.mjs";

function localIndexPresent() {
  return (
    fs.existsSync(EXPERIENCE_VECTORS_JSON_PATH) ||
    fs.existsSync(EXPERIENCE_INDEX_JSON_PATH)
  );
}

function packagedIndexPresent() {
  return (
    fs.existsSync(PACKAGED_INDEX_VECTORS_PATH) &&
    fs.existsSync(PACKAGED_INDEX_META_PATH)
  );
}

/**
 * Copy packaged vectors + meta into state/experience-index when local is empty.
 * @returns {{ seeded: boolean, reason: string }}
 */
export function seedLocalIndexFromPackaged() {
  if (localIndexPresent()) {
    return { seeded: false, reason: "local_present" };
  }
  if (!packagedIndexPresent()) {
    return { seeded: false, reason: "packaged_missing" };
  }

  fs.mkdirSync(EXPERIENCE_INDEX_DIR, { recursive: true });
  fs.copyFileSync(PACKAGED_INDEX_VECTORS_PATH, EXPERIENCE_VECTORS_JSON_PATH);
  fs.copyFileSync(PACKAGED_INDEX_META_PATH, EXPERIENCE_INDEX_JSON_PATH);
  resetVectorIndexCache();
  return { seeded: true, reason: "copied_packaged" };
}

export function hasPackagedIndex() {
  return packagedIndexPresent();
}
