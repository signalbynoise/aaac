/**
 * V6 — Structured repo-memory progress events for Agentic OS toasts.
 */
import fs from "fs";
import path from "path";
import { isoNow } from "../lib.mjs";
import { REPO_EVENTS_PATH, STATE_ROOT } from "./paths.mjs";

/**
 * @param {{ phase: string, detail?: object, level?: string }} event
 */
export function emitRepoMemoryEvent(event) {
  const row = {
    type: "repo_memory",
    phase: event.phase,
    level: event.level ?? "info",
    detail: event.detail ?? {},
    at: isoNow(),
  };
  try {
    fs.mkdirSync(STATE_ROOT, { recursive: true });
    fs.appendFileSync(REPO_EVENTS_PATH, `${JSON.stringify(row)}\n`);
  } catch {
    // non-fatal
  }
  if (process.env.AAAC_REPO_MEMORY_EVENTS === "stdout") {
    try {
      process.stdout.write(`${JSON.stringify(row)}\n`);
    } catch {
      // ignore
    }
  }
  return row;
}

/**
 * Read recent events (newest last).
 * @param {number} [limit]
 */
export function readRepoMemoryEvents(limit = 50) {
  try {
    if (!fs.existsSync(REPO_EVENTS_PATH)) return [];
    const lines = fs
      .readFileSync(REPO_EVENTS_PATH, "utf8")
      .split("\n")
      .filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Consume (truncate) events after reading — optional for IPC pollers.
 */
export function consumeRepoMemoryEvents() {
  const events = readRepoMemoryEvents(200);
  try {
    if (fs.existsSync(REPO_EVENTS_PATH)) {
      fs.writeFileSync(REPO_EVENTS_PATH, "");
    }
  } catch {
    // ignore
  }
  return events;
}

export function repoEventsPath() {
  return path.resolve(REPO_EVENTS_PATH);
}
