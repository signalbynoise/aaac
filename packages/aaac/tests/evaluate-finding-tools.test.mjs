import { describe, expect, it } from "vitest";
import {
  evaluateFindingTool,
  evaluateReadBudget,
  evaluateToolAccess,
  knownPathsFromPhaseContext,
  pathInKnownSet,
} from "../src/run-engine/evaluate-finding-tools.mjs";
import { normalizeRetrievalMiss } from "../src/run-engine/retrieval-miss.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("evaluateFindingTool", () => {
  const pc = {
    experience: {
      repo_memory: {
        focus_paths: ["apps/foo/src/a.ts", "apps/foo/src/b.ts"],
        meta: { read_budgets: { max_agent_files_read: 16 } },
      },
    },
  };

  it("denies Glob without authorized_fallback", () => {
    const d = evaluateFindingTool({ toolName: "Glob", toolInput: {}, phaseContext: pc });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/authorized_fallback/);
  });

  it("denies unscoped Grep without authorized_fallback", () => {
    const d = evaluateFindingTool({
      toolName: "Grep",
      toolInput: { pattern: "foo" },
      phaseContext: pc,
    });
    expect(d.allow).toBe(false);
  });

  it("allows Grep when authorized and scoped to known path", () => {
    const withFb = {
      ...pc,
      authorized_fallback: {
        enabled: true,
        paths: ["apps/foo/src/a.ts"],
        tools: ["Grep"],
        max_searches: 2,
      },
    };
    const d = evaluateFindingTool({
      toolName: "Grep",
      toolInput: { path: "apps/foo/src/a.ts", pattern: "export" },
      phaseContext: withFb,
      gapSearchesUsed: 0,
    });
    expect(d.allow).toBe(true);
  });

  it("denies Grep scoped outside authorized paths", () => {
    const withFb = {
      ...pc,
      authorized_fallback: {
        enabled: true,
        paths: ["apps/foo/src/a.ts"],
        tools: ["Grep"],
        max_searches: 2,
      },
    };
    const d = evaluateFindingTool({
      toolName: "Grep",
      toolInput: { path: "packages/other/x.ts", pattern: "export" },
      phaseContext: withFb,
    });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("grep_not_scoped_to_known_paths");
  });

  it("allows Read under budget via evaluateToolAccess", () => {
    const d = evaluateToolAccess({
      toolName: "Read",
      toolInput: { path: "apps/foo/src/a.ts", offset: 1, limit: 40 },
      phaseContext: pc,
      counters: { files_read: 0, full_file_opens: 0, gap_searches: 0 },
    });
    expect(d.allow).toBe(true);
  });

  it("denies Read when files_read budget exceeded", () => {
    const d = evaluateReadBudget({
      toolName: "Read",
      toolInput: { path: "a.ts", offset: 1, limit: 10 },
      budgets: { max_agent_files_read: 2, max_full_file_opens: 4, max_gap_search_globs: 8 },
      counters: { files_read: 2, full_file_opens: 0, gap_searches: 0 },
    });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("files_read_budget");
  });

  it("knownPathsFromPhaseContext collects focus paths", () => {
    const paths = knownPathsFromPhaseContext(pc);
    expect(paths).toContain("apps/foo/src/a.ts");
    expect(pathInKnownSet("apps/foo/src/a.ts", paths)).toBe(true);
  });
});

describe("retrieval_miss", () => {
  it("normalizes miss payload", () => {
    const n = normalizeRetrievalMiss({ sought: "OpenGridAgentCard", reason: "not_in_focus" });
    expect(n.ok).toBe(true);
    expect(n.miss.sought).toBe("OpenGridAgentCard");
  });

  it("rejects empty sought", () => {
    const n = normalizeRetrievalMiss({ reason: "other" });
    expect(n.ok).toBe(false);
  });
});

describe("hooks.json finding matcher", () => {
  it("preToolUse matcher includes Read and Grep", () => {
    const hooksPath = path.join(
      __dirname,
      "../templates/cursor/hooks.json",
    );
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    const matcher = hooks.hooks.preToolUse[0].matcher;
    expect(matcher).toMatch(/Read/);
    expect(matcher).toMatch(/Grep/);
    expect(matcher).toMatch(/Glob/);
    expect(matcher).toMatch(/SemanticSearch/);
  });
});
