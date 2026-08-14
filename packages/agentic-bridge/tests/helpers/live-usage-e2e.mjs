/**
 * Shared helpers for live Cursor usage-path e2e tests.
 * Opt in with LIVE_CURSOR_USAGE_E2E=1 (real network + billed agent turns).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeUsageContextPercent, resolveModelContextWindow } from "../../src/cursor-usage.mjs";

export const LIVE_USAGE_E2E = process.env.LIVE_CURSOR_USAGE_E2E === "1";

export const E2E_MODEL = process.env.CURSOR_MODEL?.trim() || "grok-4.6-fast";

export const E2E_PROMPT =
  "Reply with exactly the single word pong and nothing else. Do not use tools, read files, or run commands.";

export function createE2eWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-usage-e2e-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# usage e2e workspace\n");
  return dir;
}

export function derivedContextPercent(usageComponents, model = E2E_MODEL) {
  const window = resolveModelContextWindow(model);
  const input = usageComponents?.input ?? usageComponents?.inputTokens ?? 0;
  const output = usageComponents?.output ?? usageComponents?.outputTokens ?? 0;
  return computeUsageContextPercent({
    input,
    output,
    model,
    contextWindow: window,
  });
}

export function assertExactUsageShape(metrics, { source }) {
  if (metrics.tokens == null || !(metrics.tokens > 0)) {
    throw new Error(
      `Expected exact token total > 0 from ${source}; got tokens=${metrics.tokens}`,
    );
  }
  if (metrics.context == null || !(metrics.context >= 0)) {
    throw new Error(
      `Expected derived context percent from ${source}; got context=${metrics.context}`,
    );
  }
  if (metrics.tokenSource !== source) {
    throw new Error(
      `Expected tokenSource=${source}; got ${metrics.tokenSource}`,
    );
  }
}
