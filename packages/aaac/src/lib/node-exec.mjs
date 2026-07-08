import { spawnSync } from "child_process";

/** Env for running Node scripts when the host process is Electron (Agentic OS). */
export function nodeScriptEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  return env;
}

/** spawnSync helper — avoids Electron GUI subprocesses hanging after script completion. */
export function spawnNodeScript(scriptPath, args = [], options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    ...options,
    env: nodeScriptEnv(options.env),
  });
}
