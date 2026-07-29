/**
 * Cursor CLI authentication — browser login via `cursor agent login`.
 * The SDK does not auto-discover IDE credentials; the CLI does after login.
 * @see https://cursor.com/docs/sdk/typescript#authentication
 */
import { spawnSync } from "child_process";
import fs from "fs";
import { createLogger } from "./logger.mjs";

const log = createLogger("agentic-bridge:cursor-auth");

const DEFAULT_CURSOR_BIN = "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";

export function resolveCursorBin() {
  if (process.env.CURSOR_AGENT_BIN && fs.existsSync(process.env.CURSOR_AGENT_BIN)) {
    return process.env.CURSOR_AGENT_BIN;
  }
  if (fs.existsSync(DEFAULT_CURSOR_BIN)) return DEFAULT_CURSOR_BIN;
  const home = process.env.HOME || "";
  for (const cand of [
    `${home}/.local/bin/cursor`,
    `${home}/.local/bin/agent`,
    `${home}/.local/bin/cursor-agent`,
  ]) {
    if (fs.existsSync(cand)) return cand;
  }
  const whichCursor = spawnSync("which", ["cursor"], { encoding: "utf8" });
  if (whichCursor.status === 0 && whichCursor.stdout.trim()) {
    return whichCursor.stdout.trim();
  }
  const whichAgent = spawnSync("which", ["agent"], { encoding: "utf8" });
  if (whichAgent.status === 0 && whichAgent.stdout.trim()) {
    return whichAgent.stdout.trim();
  }
  return null;
}

/** Linux `agent` binary vs macOS `cursor agent` subcommand. */
export function cursorAgentArgv(bin, agentArgs) {
  const base = String(bin).split("/").pop();
  if (base === "agent" || base === "cursor-agent") {
    return [...agentArgs];
  }
  return ["agent", ...agentArgs];
}

function runCursorAgent(args, { timeoutMs = 120_000 } = {}) {
  const bin = resolveCursorBin();
  if (!bin) {
    return { ok: false, status: 127, stdout: "", stderr: "cursor binary not found" };
  }

  return spawnSync(bin, cursorAgentArgv(bin, args), {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env },
    maxBuffer: 4 * 1024 * 1024,
  });
}

/**
 * @returns {{ loggedIn: boolean, email: string | null, userId: number | null, source: 'cli' | 'env' | null }}
 */
export function getCursorAuthStatus() {
  if (process.env.CURSOR_API_KEY?.trim()) {
    return {
      loggedIn: true,
      email: null,
      userId: null,
      source: "env",
      viaApiKey: true,
    };
  }

  const result = runCursorAgent(["whoami", "--format", "json"], { timeoutMs: 15_000 });
  if ((result.status ?? 1) !== 0) {
    log.debug("status", "Cursor CLI not authenticated", { stderr: result.stderr?.slice(0, 200) });
    return {
      loggedIn: false,
      email: null,
      userId: null,
      source: null,
      viaApiKey: false,
    };
  }

  try {
    const payload = JSON.parse(result.stdout.trim());
    const loggedIn = Boolean(payload.isAuthenticated ?? payload.status === "authenticated");
    return {
      loggedIn,
      email: payload.userInfo?.email ?? null,
      userId: payload.userInfo?.userId ?? null,
      source: loggedIn ? "cli" : null,
      viaApiKey: false,
    };
  } catch (err) {
    log.warn("status", "Failed to parse whoami JSON", { error: String(err) });
    return {
      loggedIn: false,
      email: null,
      userId: null,
      source: null,
      viaApiKey: false,
    };
  }
}

export function isCursorAuthenticated() {
  const status = getCursorAuthStatus();
  return status.loggedIn;
}

/**
 * Opens browser OAuth/login flow via Cursor CLI.
 */
export function loginWithCursor() {
  log.info("login", "Starting cursor agent login");
  const result = runCursorAgent(["login"], { timeoutMs: 300_000 });
  if ((result.status ?? 1) !== 0) {
    log.error("login", "Login failed", { stderr: result.stderr });
    throw new Error(result.stderr?.trim() || "cursor agent login failed");
  }
  return getCursorAuthStatus();
}

export function logoutFromCursor() {
  log.info("logout", "Signing out of Cursor CLI");
  const result = runCursorAgent(["logout"], { timeoutMs: 30_000 });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr?.trim() || "cursor agent logout failed");
  }
  return { loggedIn: false };
}
