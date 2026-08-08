/**
 * Live e2e: Cursor SDK Agent usage path (one isolated local agent).
 * Requires CURSOR_API_KEY (SDK does not use CLI login credentials).
 * Run: LIVE_CURSOR_USAGE_E2E=1 pnpm --filter @ludecker/agentic-bridge test:e2e:sdk-usage
 */
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  LIVE_USAGE_E2E,
  E2E_MODEL,
  E2E_PROMPT,
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

describeLive("e2e SDK usage path", () => {
  it(
    "delivers exact tokens and derived context for one agent via @cursor/sdk",
    async () => {
      const apiKey = process.env.CURSOR_API_KEY?.trim();
      expect(
        apiKey,
        "CURSOR_API_KEY is required for the SDK usage path (CLI login is not enough)",
      ).toBeTruthy();

      let Agent;
      try {
        ({ Agent } = await import("@cursor/sdk"));
      } catch (err) {
        throw new Error(`Failed to import @cursor/sdk: ${err?.message ?? err}`);
      }
      expect(typeof Agent?.prompt).toBe("function");

      const cwd = createE2eWorkspace();
      workspaces.push(cwd);

      const turnUsages = [];
      const agent = await Agent.create({
        apiKey,
        model: { id: E2E_MODEL },
        local: { cwd },
      });

      let result;
      try {
        const run = await agent.send(E2E_PROMPT);
        for await (const event of run.stream()) {
          if (event?.type === "usage" && event.usage) {
            turnUsages.push(event.usage);
          }
        }
        result = await run.wait();
      } finally {
        agent.close?.();
      }

      expect(result?.status, `SDK run status=${result?.status}`).toBe(
        "finished",
      );

      const usage = result.usage ?? turnUsages.at(-1);
      expect(
        usage,
        "SDK result.usage (and stream usage events) were undefined — runtime did not report tokens",
      ).toBeTruthy();
      expect(usage.totalTokens, "SDK totalTokens").toBeGreaterThan(0);
      expect(usage.inputTokens, "SDK inputTokens").toBeGreaterThanOrEqual(0);
      expect(usage.outputTokens, "SDK outputTokens").toBeGreaterThanOrEqual(0);

      const context = derivedContextPercent(
        {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
        E2E_MODEL,
      );
      expect(
        context,
        "Derived context percent from SDK usage ÷ model window",
      ).not.toBeNull();
      expect(context).toBeGreaterThanOrEqual(0);

      // Surface for humans reading vitest output
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            path: "sdk",
            model: E2E_MODEL,
            tokens: usage.totalTokens,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            contextPercent: context,
            turnUsageEvents: turnUsages.length,
            requestId: result.requestId ?? null,
          },
          null,
          2,
        ),
      );
    },
    240_000,
  );
});
