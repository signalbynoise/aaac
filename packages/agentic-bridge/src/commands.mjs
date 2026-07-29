import fs from "fs";
import path from "path";
import { resolveWorkspacePaths } from "./paths.mjs";

/**
 * @returns {{ commands: string[]; aliases: string[] }}
 */
export function listAaocCommands(workspaceRoot) {
  const { aaacRoot } = resolveWorkspacePaths(workspaceRoot);
  const registryPath = path.join(aaacRoot, "runtime-registry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const commands = Object.keys(registry.commands ?? {}).sort();
  const aliases = Object.keys(registry.aliases ?? {}).sort();
  return { commands, aliases };
}

/**
 * Normalize user input to a slash command prompt (/command domain "intent").
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeAaocPrompt(raw) {
  if (!raw || typeof raw !== "string") return null;
  const body = raw.trim().replace(/^[\s/]+/, "").trim();
  if (!body) return null;
  return `/${body}`;
}
