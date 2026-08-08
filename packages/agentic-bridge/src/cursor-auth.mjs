/**
 * Cursor CLI authentication — browser login via `cursor agent login`.
 * The SDK does not auto-discover IDE credentials; the CLI does after login.
 * @see https://cursor.com/docs/sdk/typescript#authentication
 */
import { spawn } from "child_process";
import fs from "fs";
import { createLogger } from "./logger.mjs";

const log = createLogger("agentic-bridge:cursor-auth");

const DEFAULT_CURSOR_BIN = "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";
const WHICH_TIMEOUT_MS = 5_000;
const KILL_GRACE_MS = 2_000;

/**
 * Spawn a process and capture stdout/stderr with optional timeout.
 * Compatible with prior spawnSync result shape: { status, stdout, stderr }.
 */
function spawnCapture(command, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer = null;

    const settle = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      resolve(payload);
    };

    const timeoutTimer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, KILL_GRACE_MS);
      settle({
        status: null,
        stdout,
        stderr: `timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      if (killTimer) clearTimeout(killTimer);
      settle({ status: 1, stdout, stderr: String(err) });
    });
    child.on("close", (code) => {
      if (killTimer) clearTimeout(killTimer);
      settle({
        status: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function whichBin(name) {
  const result = await spawnCapture("which", [name], { timeoutMs: WHICH_TIMEOUT_MS });
  if ((result.status ?? 1) === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return null;
}

export async function resolveCursorBin() {
  if (process.env.CURSOR_AGENT_BIN && fs.existsSync(process.env.CURSOR_AGENT_BIN)) {
    return process.env.CURSOR_AGENT_BIN;
  }
  if (process.env.CURSOR_BIN && fs.existsSync(process.env.CURSOR_BIN)) {
    return process.env.CURSOR_BIN;
  }
  if (fs.existsSync(DEFAULT_CURSOR_BIN)) return DEFAULT_CURSOR_BIN;
  const home = process.env.HOME || "";
  for (const cand of [
    `${home}/.local/bin/agent`,
    `${home}/.local/bin/cursor-agent`,
    `${home}/.local/bin/cursor`,
  ]) {
    if (fs.existsSync(cand)) return cand;
  }
  const whichAgent = await whichBin("agent");
  if (whichAgent) return whichAgent;
  const whichCursor = await whichBin("cursor");
  if (whichCursor) return whichCursor;
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

async function runCursorAgent(args, { timeoutMs = 120_000 } = {}) {
  const bin = await resolveCursorBin();
  if (!bin) {
    return { ok: false, status: 127, stdout: "", stderr: "cursor binary not found" };
  }

  return spawnCapture(bin, cursorAgentArgv(bin, args), { timeoutMs });
}

/**
 * @returns {Promise<{ loggedIn: boolean, email: string | null, userId: number | null, source: 'cli' | 'env' | null }>}
 */
export async function getCursorAuthStatus() {
  if (process.env.CURSOR_API_KEY?.trim()) {
    return {
      loggedIn: true,
      email: null,
      userId: null,
      source: "env",
      viaApiKey: true,
    };
  }

  const result = await runCursorAgent(["whoami", "--format", "json"], { timeoutMs: 15_000 });
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

export async function isCursorAuthenticated() {
  const status = await getCursorAuthStatus();
  return status.loggedIn;
}

/**
 * Opens browser OAuth/login flow via Cursor CLI.
 */
export async function loginWithCursor() {
  log.info("login", "Starting cursor agent login");
  const result = await runCursorAgent(["login"], { timeoutMs: 300_000 });
  if ((result.status ?? 1) !== 0) {
    log.error("login", "Login failed", { stderr: result.stderr });
    throw new Error(result.stderr?.trim() || "cursor agent login failed");
  }
  return getCursorAuthStatus();
}

export async function logoutFromCursor() {
  log.info("logout", "Signing out of Cursor CLI");
  const result = await runCursorAgent(["logout"], { timeoutMs: 30_000 });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr?.trim() || "cursor agent logout failed");
  }
  return { loggedIn: false };
}
