import { describe, expect, it } from "vitest";
import {
  createStreamJsonLineBuffer,
  mapStreamJsonToolCall,
  parseStreamJsonLine,
} from "../src/stream-json-tools.mjs";

function verifySemanticArgumentsRemainIsolated() {
  const semantic = parseStreamJsonLine(
    JSON.stringify({
      type: "tool_call",
      subtype: "started",
      call_id: "semantic-1",
      tool_call: {
        function: {
          name: "functions.UpdateCurrentStep",
          arguments: JSON.stringify({
            current_step: "Reviewing replay behavior",
            final_summary: "Verified replay behavior.",
          }),
        },
      },
    }),
  );
  expect(semantic).toMatchObject({
    kind: "tool",
    toolName: "UpdateCurrentStep",
    arguments: {
      current_step: "Reviewing replay behavior",
      final_summary: "Verified replay behavior.",
    },
  });

  const ordinary = parseStreamJsonLine(
    JSON.stringify({
      type: "tool_call",
      subtype: "started",
      call_id: "read-1",
      tool_call: {
        function: {
          name: "Read",
          arguments: JSON.stringify({
            path: "/Users/example/private-file.ts",
            current_step: "Untrusted ordinary argument",
          }),
        },
      },
    }),
  );
  expect(ordinary).toMatchObject({
    kind: "tool",
    toolName: "Read",
    path: "/Users/example/private-file.ts",
  });
  expect(ordinary).not.toHaveProperty("arguments");
  expect(JSON.stringify(ordinary)).not.toContain("Untrusted ordinary argument");
}

describe("stream-json-tools", () => {
  it("maps read/write/edit/grep CLI keys to IDE tool names", () => {
    expect(mapStreamJsonToolCall({ readToolCall: { args: { path: "a.ts" } } })).toEqual({
      toolName: "Read",
      path: "a.ts",
      cliKey: "readToolCall",
    });
    expect(
      mapStreamJsonToolCall({
        writeToolCall: { args: { path: "b.ts", fileText: "x" } },
      }),
    ).toMatchObject({ toolName: "Write", path: "b.ts" });
    expect(
      mapStreamJsonToolCall({
        editToolCall: { args: { path: "c.ts" } },
      }),
    ).toMatchObject({ toolName: "StrReplace", path: "c.ts" });
    expect(
      mapStreamJsonToolCall({
        grepToolCall: { args: { pattern: "foo" } },
      }),
    ).toMatchObject({ toolName: "Grep", path: null });
    expect(
      mapStreamJsonToolCall({
        shellToolCall: { args: { command: "ls" } },
      }),
    ).toMatchObject({ toolName: "Shell" });
  });
});

describe("stream-json-tools", () => {

  it("parseStreamJsonLine extracts tool_call started/completed", () => {
    const started = parseStreamJsonLine(
      JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "c1",
        tool_call: { readToolCall: { args: { path: "docs/architecture.md" } } },
      }),
    );
    expect(started).toEqual({
      kind: "tool",
      toolName: "Read",
      path: "docs/architecture.md",
      callId: "c1",
      subtype: "started",
    });

    const completed = parseStreamJsonLine(
      JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        call_id: "c1",
        tool_call: {
          readToolCall: {
            args: { path: "docs/architecture.md" },
            result: { success: { totalLines: 10 } },
          },
        },
      }),
    );
    expect(completed?.kind).toBe("tool");
    expect(completed?.toolName).toBe("Read");
  });
});

describe("stream-json-tools", () => {
  it("preserves UpdateCurrentStep arguments but keeps ordinary arguments technical-only", verifySemanticArgumentsRemainIsolated);
});

describe("stream-json-tools", () => {

  it("parseStreamJsonLine extracts assistant text and result", () => {
    const assistant = parseStreamJsonLine(
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Findings so far" }],
        },
      }),
    );
    expect(assistant).toEqual({ kind: "assistant", text: "Findings so far" });

    const result = parseStreamJsonLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Done",
        session_id: "sess-1",
      }),
    );
    expect(result).toEqual({ kind: "result", text: "Done", sessionId: "sess-1" });
  });

  it("line buffer splits chunked NDJSON", () => {
    const buf = createStreamJsonLineBuffer();
    const a = buf.push('{"type":"system"}\n{"type":"tool_call","subtype":"started","call_id":"x","tool_call":{"readToolCall":{"args":{"path":"p.ts"}}}');
    expect(a).toHaveLength(1);
    const b = buf.push("}\n");
    expect(b).toHaveLength(1);
    const parsed = parseStreamJsonLine(b[0]);
    expect(parsed?.toolName).toBe("Read");
  });

  it("ignores non-JSON and unknown events", () => {
    expect(parseStreamJsonLine("Working…")).toBeNull();
    expect(parseStreamJsonLine('{"type":"system","subtype":"init"}')).toBeNull();
    expect(parseStreamJsonLine("")).toBeNull();
  });
});
