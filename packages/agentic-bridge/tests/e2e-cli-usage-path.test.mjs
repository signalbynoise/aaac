/**
 * Live e2e: Cursor CLI stream-json usage path (one isolated agent process).
 * Run: LIVE_CURSOR_USAGE_E2E=1 pnpm --filter @ludecker/agentic-bridge test:e2e:cli-usage
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  cursorAgentArgv,
  getCursorAuthStatus,
  resolveCursorBin,
} from "../src/cursor-auth.mjs";
import {
  accumulateCursorUsage,
  createCursorUsageAccumulator,
  cursorUsageMetrics,
} from "../src/cursor-usage.mjs";
import {
  createStreamJsonLineBuffer,
  parseStreamJsonLine,
} from "../src/stream-json-tools.mjs";
import {
  LIVE_USAGE_E2E,
  E2E_MODEL,
  E2E_PROMPT,
  assertExactUsageShape,
  createE2eWorkspace,
  derivedContextPercent,
} from "./helpers/live-usage-e2e.mjs";

const describeLive = LIVE_USAGE_E2E ? describe : describe.skip;
const workspaces = [];

afterAll(() => {
  for (const dir of workspaces) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function runCliAgentStreamJson({ cwd, prompt, model, timeoutMs = 180_000 }) {
  const bin = await resolveCursorBin();
  if (!bin) throw new Error("cursor agent binary not found");

  const agentArgs = [
    "-p",
    "-f",
    "--trust",
    "--approve-mcps",
    "--output-format",
    "stream-json",
    "--model",
    model,
  ];
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (apiKey) agentArgs.push("--api-key", apiKey);
  agentArgs.push(prompt);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, cursorAgentArgv(bin, agentArgs), {
      cwd,
      env: { ...process.env, CI: process.env.CI ?? "1", CURSOR_MODEL: model },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const usage = createCursorUsageAccumulator();
    const lineBuffer = createStreamJsonLineBuffer();
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`CLI agent timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    const ingest = (chunk) => {
      const text = String(chunk);
      stdout += text;
      for (const line of lineBuffer.push(text)) {
        const parsed = parseStreamJsonLine(line);
        if (parsed?.kind === "usage") accumulateCursorUsage(usage, parsed);
      }
    };

    child.stdout.on("data", ingest);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => finish(() => reject(err)));
    child.on("close", (code) => {
      for (const line of lineBuffer.flush()) {
        const parsed = parseStreamJsonLine(line);
        if (parsed?.kind === "usage") accumulateCursorUsage(usage, parsed);
      }
      finish(() =>
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          metrics: cursorUsageMetrics(usage),
        }),
      );
    });
  });
}

describeLive("e2e CLI usage path", () => {
  it(
    "delivers exact tokens and derived context for one agent via stream-json",
    async () => {
      const auth = await getCursorAuthStatus();
      expect(auth.loggedIn, "CLI/login or CURSOR_API_KEY required").toBe(true);

      const cwd = createE2eWorkspace();
      workspaces.push(cwd);

      const result = await runCliAgentStreamJson({
        cwd,
        prompt: E2E_PROMPT,
        model: E2E_MODEL,
      });

      expect(
        result.exitCode,
        `CLI exit ${result.exitCode}\nstderr: ${result.stderr.slice(0, 800)}`,
      ).toBe(0);

      const metrics = {
        ...result.metrics,
        context:
          result.metrics.context ??
          derivedContextPercent(result.metrics.components, E2E_MODEL),
      };

      try {
        assertExactUsageShape(metrics, { source: "cursor_cli_usage" });
      } catch (err) {
        throw new Error(
          `${err.message}\nCLI path did not deliver usable metering.\n` +
            `tokenSource=${result.metrics.tokenSource} tokens=${result.metrics.tokens} ` +
            `context=${result.metrics.context}\n` +
            `stdoutTail=${result.stdout.slice(-1200)}`,
        );
      }

      expect(metrics.tokens).toBeGreaterThan(0);
      expect(metrics.context).toBeGreaterThanOrEqual(0);
      expect(metrics.tokenSource).toBe("cursor_cli_usage");
      expect(metrics.inputTokens).toBeGreaterThanOrEqual(0);
      expect(metrics.outputTokens).toBeGreaterThanOrEqual(0);
      expect(metrics.cacheReadTokens).toBeGreaterThanOrEqual(0);
      expect(metrics.cacheWriteTokens).toBeGreaterThanOrEqual(0);
      expect(
        metrics.inputTokens +
          metrics.outputTokens +
          metrics.cacheReadTokens +
          metrics.cacheWriteTokens,
      ).toBe(metrics.tokens);

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            path: "cli",
            model: E2E_MODEL,
            tokens: metrics.tokens,
            inputTokens: metrics.inputTokens,
            outputTokens: metrics.outputTokens,
            cacheReadTokens: metrics.cacheReadTokens,
            cacheWriteTokens: metrics.cacheWriteTokens,
            contextPercent: metrics.context,
            tokenSource: metrics.tokenSource,
          },
          null,
          2,
        ),
      );
    },
    240_000,
  );
});
