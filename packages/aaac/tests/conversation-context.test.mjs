import { describe, it, expect } from "vitest";
import {
  extractConversationContextFromHook,
  resolveContextWindowSize,
} from "../src/run-engine/conversation-context.mjs";

describe("conversation-context", () => {
  it("extractConversationContextFromHook reads preCompact fields", () => {
    const result = extractConversationContextFromHook({
      context_usage_percent: 75,
      context_tokens: 150800,
      context_window_size: 200000,
    });
    expect(result).toEqual({
      conversation_tokens: 150800,
      context_usage_percent: 75.4,
      context_window_size: 200000,
      source: "cursor_hook",
    });
  });

  it("extractConversationContextFromHook normalizes fraction-only percent", () => {
    const result = extractConversationContextFromHook({
      context_usage_percent: 0.67,
      context_window_size: 200000,
    });
    expect(result?.context_usage_percent).toBe(67);
    expect(result?.conversation_tokens).toBe(134000);
  });

  it("extractConversationContextFromHook prefers tokens when deriving percent", () => {
    const result = extractConversationContextFromHook({
      context_usage_percent: 0.67,
      context_tokens: 134000,
      context_window_size: 200000,
    });
    expect(result?.context_usage_percent).toBe(67);
    expect(result?.conversation_tokens).toBe(134000);
  });

  it("extractConversationContextFromHook derives percent from tokens", () => {
    const result = extractConversationContextFromHook({
      context_tokens: 100000,
      context_window_size: 200000,
    });
    expect(result?.context_usage_percent).toBe(50);
    expect(result?.conversation_tokens).toBe(100000);
  });

  it("resolveContextWindowSize reads model_params context", () => {
    expect(
      resolveContextWindowSize({
        model_params: [{ id: "context", value: "1m" }],
      }),
    ).toBe(1_000_000);
  });
});
