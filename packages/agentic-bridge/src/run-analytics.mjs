import { runEngineScript, parseJsonStdout } from "./paths.mjs";
import { createLogger } from "./logger.mjs";

const log = createLogger("agentic-bridge:analytics");

export async function getRunAnalytics(workspaceRoot, { runId = null } = {}) {
  const argv = ["--json"];
  if (runId) {
    argv.push("--run-id", runId);
  } else {
    argv.push("--workspace-root", workspaceRoot);
  }

  const result = await runEngineScript(workspaceRoot, "query-run-analytics.mjs", argv);
  if (!result.ok) {
    log.warn("analytics", "Query failed", { stderr: result.stderr?.slice(0, 200) });
    return { ok: false, enabled: false, error: result.stderr || "query-run-analytics failed" };
  }

  try {
    return parseJsonStdout(result.stdout);
  } catch (err) {
    return { ok: false, enabled: false, error: String(err.message ?? err) };
  }
}

export async function syncAllRuns(workspaceRoot) {
  const result = await runEngineScript(workspaceRoot, "persist-run.mjs", ["--all"]);
  if (!result.ok) {
    return { ok: false, error: result.stderr || "persist-run --all failed" };
  }
  try {
    return parseJsonStdout(result.stdout);
  } catch {
    return { ok: true, raw: result.stdout };
  }
}
