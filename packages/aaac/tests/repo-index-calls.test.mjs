/**
 * Static call-graph heuristics for repo index.
 */
import { describe, expect, it } from "vitest";
import {
  extractImportBindings,
  extractCalledLocals,
  buildCallEdgesForFile,
} from "../src/run-engine/experience/repo-index/calls.mjs";

describe("repo-index calls", () => {
  it("extracts default, named, and namespace import bindings", () => {
    const source = `
      import HomePage from '@/pages/HomePage';
      import { route, nest as nested } from './router';
      import * as utils from '../utils';
      const fs = require('fs');
    `;
    const bindings = extractImportBindings(source);
    expect(bindings).toEqual(
      expect.arrayContaining([
        { local: "HomePage", spec: "@/pages/HomePage" },
        { local: "route", spec: "./router" },
        { local: "nested", spec: "./router" },
        { local: "utils", spec: "../utils" },
        { local: "fs", spec: "fs" },
      ]),
    );
  });

  it("extracts called locals and skips keywords", () => {
    const source = `
      if (ready) HomePage();
      route.go();
      new Nested();
      typeof x;
    `;
    const called = extractCalledLocals(source);
    expect(called.has("HomePage")).toBe(true);
    expect(called.has("route")).toBe(true);
    expect(called.has("Nested")).toBe(true);
    expect(called.has("if")).toBe(false);
    expect(called.has("typeof")).toBe(false);
  });

  it("builds file-level calls / called_by edges for resolved imports", () => {
    const fileSet = new Set(["src/a.ts", "src/b.ts", "src/c.ts"]);
    const edges = buildCallEdgesForFile({
      fromId: "file:src/a.ts",
      source: `
        import { helper } from './b';
        import unused from './c';
        helper();
      `,
      resolveSpec: (spec) => {
        if (spec === "./b") return "src/b.ts";
        if (spec === "./c") return "src/c.ts";
        return null;
      },
      fileSet,
      nodeIdForPath: (p) => `file:${p}`,
    });
    expect(edges).toEqual([
      {
        from: "file:src/a.ts",
        to: "file:src/b.ts",
        kind: "calls",
        weight: 1,
      },
      {
        from: "file:src/b.ts",
        to: "file:src/a.ts",
        kind: "called_by",
        weight: 1,
      },
    ]);
  });
});
