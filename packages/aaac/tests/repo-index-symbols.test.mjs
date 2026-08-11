/**
 * AST symbol/span extraction + Stage-2 focus_spans ranking.
 */
import path from "path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const EXP = path.join(PACKAGE_ROOT, "src/run-engine/experience");

const TS_FIXTURE = `
import { helper } from "./util";

/** Refresh the calendar auth token. */
export async function refreshToken(userId: string) {
  const token = helper(userId);
  return token;
}

export class AuthService {
  login() {
    return refreshToken("x");
  }
}
`;

const PY_FIXTURE = `
def refresh_token(user_id):
    return user_id

class AuthService:
    def login(self):
        return refresh_token("x")
`;

describe("repo-index AST symbols", () => {
  it("extracts refreshToken span from TypeScript via Tree-sitter", async () => {
    const { extractSymbolsForFile } = await import(
      path.join(EXP, "repo-index/symbols.mjs")
    );
    const symbols = await extractSymbolsForFile({
      path: "src/calendarApi.ts",
      source: TS_FIXTURE,
      fileNodeId: "file:src/calendarApi.ts",
    });
    const refresh = symbols.find((s) => s.name === "refreshToken");
    expect(refresh).toBeTruthy();
    expect(refresh.kind).toBe("function");
    expect(refresh.start_line).toBe(5);
    expect(refresh.end_line).toBe(8);
    expect(refresh.signature).toMatch(/refreshToken/);
    const login = symbols.find((s) => s.name === "login");
    expect(login?.parent).toBe("AuthService");
    expect(login?.kind).toBe("method");
  });

  it("extracts Python def/class spans", async () => {
    const { extractSymbolsForFile } = await import(
      path.join(EXP, "repo-index/symbols.mjs")
    );
    const symbols = await extractSymbolsForFile({
      path: "auth.py",
      source: PY_FIXTURE,
      fileNodeId: "file:auth.py",
    });
    const refresh = symbols.find((s) => s.name === "refresh_token");
    expect(refresh).toBeTruthy();
    expect(refresh.start_line).toBe(2);
    expect(refresh.end_line).toBe(3);
    expect(symbols.find((s) => s.name === "AuthService")?.kind).toBe("class");
  });

  it("pads envelopes around spans", async () => {
    const { envelopeForSpan } = await import(
      path.join(EXP, "repo-index/symbols.mjs")
    );
    expect(envelopeForSpan(10, 20, 4)).toEqual({
      envelope_start: 6,
      envelope_end: 24,
    });
    expect(envelopeForSpan(2, 5, 4)).toEqual({
      envelope_start: 1,
      envelope_end: 9,
    });
  });
});

describe("repo-index Stage-2 focus_spans", () => {
  it("ranks spans only inside Stage-1 candidate paths", async () => {
    const { extractSymbolsForFile } = await import(
      path.join(EXP, "repo-index/symbols.mjs")
    );
    const { rankFocusSpans } = await import(
      path.join(EXP, "repo-index/span-retrieve.mjs")
    );

    const a = await extractSymbolsForFile({
      path: "src/calendarApi.ts",
      source: TS_FIXTURE,
      fileNodeId: "file:src/calendarApi.ts",
    });
    const b = await extractSymbolsForFile({
      path: "src/other.ts",
      source: "export function unrelated() {\n  return 1;\n}\n",
      fileNodeId: "file:src/other.ts",
    });
    expect(a.length).toBeGreaterThan(0);

    const spans = rankFocusSpans({
      queryText: "calendar authentication refreshToken",
      candidatePaths: ["src/calendarApi.ts"],
      symbols: [...a, ...b],
      rm: {
        final_spans: 4,
        spans_per_file: 2,
        span_envelope_lines: 4,
      },
    });

    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((s) => s.path === "src/calendarApi.ts")).toBe(true);
    expect(spans.some((s) => s.symbol === "refreshToken")).toBe(true);
    const hit = spans.find((s) => s.symbol === "refreshToken");
    expect(hit.envelope_start).toBeLessThanOrEqual(hit.start);
    expect(hit.envelope_end).toBeGreaterThanOrEqual(hit.end);
  });
});
