/**
 * Invoke Cursor Agent non-interactively for yield handling.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { REPO_ROOT, isoNow } from "../../run-engine/lib.mjs";

const DEFAULT_CURSOR_BIN = "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";

export function resolveCursorBin() {
  if (process.env.CURSOR_AGENT_BIN && fs.existsSync(process.env.CURSOR_AGENT_BIN)) {
    return process.env.CURSOR_AGENT_BIN;
  }
  if (fs.existsSync(DEFAULT_CURSOR_BIN)) return DEFAULT_CURSOR_BIN;
  const which = spawnSync("which", ["cursor"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return null;
}

export function invokeCursorAgent(prompt, opts = {}) {
  const bin = resolveCursorBin();
  if (!bin) {
    return { ok: false, status: 127, stdout: "", stderr: "cursor agent binary not found" };
  }

  const cwd = opts.cwd ?? REPO_ROOT;
  const timeoutMs = opts.timeoutMs ?? 900_000;
  const result = spawnSync(bin, ["agent", "-p", "-f", "--approve-mcps", "--output-format", "text", prompt], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, CI: process.env.CI ?? "1" },
    maxBuffer: 20 * 1024 * 1024,
  });

  if (opts.logPath) {
    fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });
    fs.writeFileSync(
      opts.logPath,
      `# Cursor agent ${isoNow()}\n\n## Prompt\n${prompt}\n\n## Exit ${result.status}\n\n## Stdout\n${result.stdout ?? ""}\n\n## Stderr\n${result.stderr ?? ""}\n`,
    );
  }

  return {
    ok: (result.status ?? 1) === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
