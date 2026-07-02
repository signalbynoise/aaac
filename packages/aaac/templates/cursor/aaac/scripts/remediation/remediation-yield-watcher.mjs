#!/usr/bin/env node
/**
 * Continuous remediation loop (machine sentinel logs).
 * Prefer remediation-cli.mjs watch for human / Cursor terminal monitoring.
 */
import { isoNow } from "../run-engine/lib.mjs";
import { runRemediationWatchLoop } from "./lib/remediation-watch-loop.mjs";

const SENTINEL = "AGENT_REMEDIATION_WATCHER";

function parseArgs(argv) {
  const out = { runId: null, campaignId: null, pollMs: 5000, maxRetries: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--poll-ms") out.pollMs = Number(argv[++i]);
    else if (a === "--max-retries") out.maxRetries = Number(argv[++i]);
  }
  return out;
}

function log(event, detail = {}) {
  const line = JSON.stringify({ at: isoNow(), event, ...detail });
  console.log(`${SENTINEL} ${line}`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.runId || !args.campaignId) {
  console.error("Usage: remediation-yield-watcher.mjs --run-id <id> --campaign-id <id>");
  process.exit(2);
}

runRemediationWatchLoop({
  ...args,
  reporter: { onEvent: (event, detail) => log(event, detail) },
}).then((code) => process.exit(code)).catch((err) => {
  log("fatal", { message: String(err?.message ?? err) });
  process.exit(2);
});
