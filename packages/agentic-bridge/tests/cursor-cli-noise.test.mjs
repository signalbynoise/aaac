import { describe, it, expect } from "vitest";
import {
  filterCursorCliStderr,
  hasSubstantiveCursorCliOutput,
  isCursorCliNoiseLine,
  isTransientNetworkError,
} from "../src/cursor-cli-noise.mjs";

describe("cursor-cli-noise", () => {
  it("isCursorCliNoiseLine filters cursor-retrieval and DNS noise", () => {
    expect(
      isCursorCliNoiseLine(
        "cursor-retrieval: tracing to /var/folders/foo/cursor_retrieval.log",
      ),
    ).toBe(true);
    expect(isCursorCliNoiseLine("getaddrinfo ENOTFOUND api2.cursor.sh")).toBe(true);
    expect(isCursorCliNoiseLine("Scanning import graph for circular dependencies")).toBe(false);
  });

  it("filterCursorCliStderr keeps real errors only", () => {
    const stderr = [
      "cursor-retrieval: tracing to /var/folders/foo.log",
      "Error: [unavailable] getaddrinfo ENOTFOUND api2.cursor.sh",
      "missing artifact: artifacts/plan.yaml",
    ].join("\n");

    expect(filterCursorCliStderr(stderr)).toBe("missing artifact: artifacts/plan.yaml");
  });

  it("filterCursorCliStderr returns empty for noise-only stderr", () => {
    const stderr =
      "cursor-retrieval: tracing to /var/folders/foo.log\nError: getaddrinfo ENOTFOUND api2.cursor.sh";
    expect(filterCursorCliStderr(stderr)).toBe("");
  });

  it("hasSubstantiveCursorCliOutput detects meaningful stdout", () => {
    const stdout = "x".repeat(100);
    expect(hasSubstantiveCursorCliOutput(stdout)).toBe(true);
    expect(hasSubstantiveCursorCliOutput("cursor-retrieval: trace")).toBe(false);
  });

  it("isTransientNetworkError detects DNS failures", () => {
    expect(
      isTransientNetworkError(new Error("getaddrinfo ENOTFOUND api2.cursor.sh")),
    ).toBe(true);
    expect(isTransientNetworkError(new Error("missing artifact: plan.yaml"))).toBe(false);
  });

  it("isCursorCliNoiseLine treats short lines as noise", () => {
    expect(isCursorCliNoiseLine("")).toBe(true);
    expect(isCursorCliNoiseLine("ok")).toBe(true);
    expect(isCursorCliNoiseLine("ENOENT")).toBe(true);
  });

  it("isCursorCliNoiseLine filters additional infra patterns", () => {
    expect(isCursorCliNoiseLine("[debug] loading run-engine loader")).toBe(true);
    expect(isCursorCliNoiseLine("artifact path: /tmp/foo.log")).toBe(true);
    expect(isCursorCliNoiseLine("getaddrinfo EAI_AGAIN api2.cursor.sh")).toBe(true);
    expect(isCursorCliNoiseLine("/var/folders/abc/cursor.log")).toBe(true);
  });

  it("filterCursorCliStderr handles CRLF and empty input", () => {
    const stderr =
      "cursor-retrieval: trace\r\nreal failure: gate blocked\r\n";
    expect(filterCursorCliStderr(stderr)).toBe("real failure: gate blocked");
    expect(filterCursorCliStderr("")).toBe("");
    expect(filterCursorCliStderr(null)).toBe("");
  });

  it("hasSubstantiveCursorCliOutput respects custom minChars threshold", () => {
    const text = "meaningful progress line here";
    expect(hasSubstantiveCursorCliOutput(text, 20)).toBe(true);
    expect(hasSubstantiveCursorCliOutput(text, 100)).toBe(false);
    expect(
      hasSubstantiveCursorCliOutput(
        "cursor-retrieval: trace\ngetaddrinfo ENOTFOUND api2.cursor.sh",
        10,
      ),
    ).toBe(false);
  });

  it("isTransientNetworkError checks err.code and fetch failures", () => {
    expect(isTransientNetworkError({ code: "ETIMEDOUT", message: "timeout" })).toBe(true);
    expect(
      isTransientNetworkError({ cause: { code: "ECONNREFUSED" }, message: "connect failed" }),
    ).toBe(true);
    expect(isTransientNetworkError(new Error("fetch failed"))).toBe(true);
    expect(isTransientNetworkError(new Error("socket hang up"))).toBe(true);
  });
});
