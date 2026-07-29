/**
 * Discover Cursor agent models via CLI (account-scoped) or SDK (API key).
 * @see https://cursor.com/docs/sdk/typescript#cursormodelslist
 */
import { createLogger } from "./logger.mjs";
import { getCursorAuthStatus, resolveCursorBin } from "./cursor-auth.mjs";
import { spawnSync } from "child_process";

const log = createLogger("agentic-bridge:cursor-models");

/** @typedef {{ id: string, pickerLabel: string, isDefault?: boolean }} CursorModelOption */

/**
 * Parse `cursor agent models` stdout into selectable model options.
 * @param {string} stdout
 * @returns {CursorModelOption[]}
 */
export function parseCursorModelsCliOutput(stdout) {
  /** @type {CursorModelOption[]} */
  const models = [];

  for (const line of String(stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "Available models" || trimmed.startsWith("Tip:")) {
      continue;
    }

    const match = trimmed.match(/^(\S+)\s+-\s+(.+)$/);
    if (!match) continue;

    const id = match[1];
    let pickerLabel = match[2].trim();
    let isDefault = false;

    const defaultSuffix = pickerLabel.match(/\s+\((current,\s*)?default\)\s*$/i);
    if (defaultSuffix) {
      isDefault = true;
      pickerLabel = pickerLabel.replace(/\s+\((current,\s*)?default\)\s*$/i, "").trim();
    }

    models.push(isDefault ? { id, pickerLabel, isDefault: true } : { id, pickerLabel });
  }

  return models;
}

function runAgentModelsCli() {
  const bin = resolveCursorBin();
  if (!bin) {
    return { ok: false, status: 127, stdout: "", stderr: "cursor binary not found" };
  }

  return spawnSync(bin, ["agent", "models"], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env },
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function listCursorModelsViaSdk() {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const { Cursor } = await import("@cursor/sdk");
    const items = await Cursor.models.list({ apiKey });
    return items.flatMap((model) => {
      const variants = model.variants?.length
        ? model.variants
        : [{ displayName: model.displayName ?? model.id, isDefault: true, params: [] }];

      return variants.map((variant) => {
        const paramSuffix = variant.params?.length
          ? `[${variant.params.map((p) => `${p.id}=${p.value}`).join(",")}]`
          : "";
        const id = paramSuffix ? `${model.id}${paramSuffix}` : model.id;
        return {
          id,
          pickerLabel: variant.displayName ?? model.displayName ?? model.id,
          isDefault: Boolean(variant.isDefault),
        };
      });
    });
  } catch (err) {
    log.warn("list", "SDK model list failed", { error: String(err) });
    return null;
  }
}

function sortCursorModels(models) {
  return [...models].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.pickerLabel.localeCompare(b.pickerLabel, undefined, { sensitivity: "base" });
  });
}

/**
 * List models available for the signed-in Cursor account.
 * Prefers CLI output (matches `agent --model`) when authenticated via CLI.
 * @returns {Promise<{ models: CursorModelOption[], source: 'cli' | 'sdk' | 'none' }>}
 */
export async function listCursorModels() {
  const auth = getCursorAuthStatus();
  if (!auth.loggedIn) {
    return { models: [], source: "none" };
  }

  if (auth.source === "cli" || auth.source === "env") {
    const result = runAgentModelsCli();
    if ((result.status ?? 1) === 0) {
      const models = sortCursorModels(parseCursorModelsCliOutput(result.stdout));
      if (models.length > 0) {
        log.info("list", "Loaded models from Cursor CLI", { count: models.length });
        return { models, source: "cli" };
      }
      log.warn("list", "Cursor CLI models output empty", { stderr: result.stderr?.slice(0, 200) });
    } else {
      log.warn("list", "Cursor CLI models command failed", {
        status: result.status,
        stderr: result.stderr?.slice(0, 200),
      });
    }
  }

  const sdkModels = await listCursorModelsViaSdk();
  if (sdkModels?.length) {
    log.info("list", "Loaded models from Cursor SDK", { count: sdkModels.length });
    return { models: sortCursorModels(sdkModels), source: "sdk" };
  }

  return { models: [], source: "none" };
}
