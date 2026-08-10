/**
 * V6 — Compressed architectural scratchpad for repo memory.
 */
import { isoNow, readJson, writeJson } from "../lib.mjs";
import { REPO_SCRATCHPAD_PATH, KNOWLEDGE_ROOT, loadRetrievalConfig } from "./paths.mjs";
import fs from "fs";
import path from "path";

export function emptyScratchpad() {
  return {
    version: 1,
    updated_at: null,
    notes: [],
    text: "",
  };
}

export function loadRepoScratchpad() {
  return readJson(REPO_SCRATCHPAD_PATH, emptyScratchpad());
}

export function saveRepoScratchpad(pad) {
  pad.updated_at = isoNow();
  writeJson(REPO_SCRATCHPAD_PATH, pad);
}

/**
 * Merge a note and compress when over budget.
 */
export function mergeScratchpadNote(pad, note, {
  maxChars = null,
} = {}) {
  const cfg = loadRetrievalConfig();
  const cap = maxChars ?? cfg.repo_memory?.scratchpad_max_chars ?? 4000;
  const entry = {
    id: note.id ?? `note-${Date.now()}`,
    text: String(note.text ?? "").slice(0, 800),
    tags: note.tags ?? [],
    at: isoNow(),
  };
  pad.notes = [...(pad.notes ?? []).filter((n) => n.id !== entry.id), entry].slice(
    -40,
  );
  pad.text = pad.notes.map((n) => n.text).join("\n");
  if (pad.text.length > cap) {
    // LIGHT-style: compress to ~half when exceeding cap
    const target = Math.floor(cap / 2);
    while (pad.text.length > target && pad.notes.length > 2) {
      pad.notes.shift();
      pad.text = pad.notes.map((n) => n.text).join("\n");
    }
    if (pad.text.length > cap) {
      pad.text = pad.text.slice(0, cap);
    }
  }
  return pad;
}

export function scratchpadExcerpt(pad, maxChars = 1200) {
  const text = pad?.text ?? "";
  if (!text) return "";
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

/** Optional markdown dump for humans. */
export function writeRepoMapFromScratchpad(pad) {
  if (!pad?.text) return null;
  fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
  const out = path.join(KNOWLEDGE_ROOT, "repo-map.md");
  fs.writeFileSync(
    out,
    `# Repository knowledge (auto)\n\nUpdated: ${isoNow()}\n\n${pad.text}\n`,
  );
  return out;
}
