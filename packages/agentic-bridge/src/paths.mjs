import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { computeWorkspacePaths } from "./aaac-status.mjs";

export { computeWorkspacePaths, getAaacStatus } from "./aaac-status.mjs";
export { installAaacInWorkspace } from "./install-workspace.mjs";

const MAX_BUFFER = 10 * 1024 * 1024;

export function resolveWorkspacePaths(workspaceRoot) {
  const paths = computeWorkspacePaths(workspaceRoot);

  if (!fs.existsSync(paths.runEngineDir)) {
    throw new Error(`AAAC not initialized at ${paths.aaacRoot}. Run: aaac init`);
  }

  return paths;
}

function loadWorkspaceDotenv(workspaceRoot) {
  const candidates = [
    path.join(workspaceRoot, "apps/website/.env.local"),
    path.join(workspaceRoot, ".env.local"),
  ];
  const merged = {};
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      merged[key] = value;
    }
  }
  return merged;
}

function resolveScriptRunnerEnv(workspaceRoot) {
  const env = { ...process.env };
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  if (workspaceRoot) {
    Object.assign(env, loadWorkspaceDotenv(workspaceRoot));
  }
  return env;
}

function appendBounded(current, chunk, maxBytes) {
  const next = current + chunk;
  if (next.length <= maxBytes) return next;
  return next.slice(0, maxBytes);
}

export function runEngineScript(workspaceRoot, scriptName, argv = []) {
  const { runEngineDir } = resolveWorkspacePaths(workspaceRoot);
  const scriptPath = path.join(runEngineDir, scriptName);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Run engine script not found: ${scriptPath}`);
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...argv], {
      cwd: workspaceRoot,
      env: {
        ...resolveScriptRunnerEnv(workspaceRoot),
        AAAC_WORKSPACE_ROOT: workspaceRoot,
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    child.stdout?.on("data", (d) => {
      stdout = appendBounded(stdout, String(d), MAX_BUFFER);
    });
    child.stderr?.on("data", (d) => {
      stderr = appendBounded(stderr, String(d), MAX_BUFFER);
    });
    child.on("error", (err) => {
      settle({ ok: false, status: 1, stdout, stderr: String(err) });
    });
    child.on("close", (code) => {
      settle({
        ok: (code ?? 1) === 0,
        status: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

export function parseJsonStdout(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lastLine = trimmed.split("\n").pop();
    return JSON.parse(lastLine ?? trimmed);
  }
}
