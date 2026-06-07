import { describe, expect, it } from "vitest";
import { isUserStopIntent } from "../../../.cursor/aaac/scripts/run-engine/lib.mjs";

describe("isUserStopIntent", () => {
  it("matches explicit stop commands", () => {
    expect(isUserStopIntent("Stop")).toBe(true);
    expect(isUserStopIntent("stop")).toBe(true);
    expect(isUserStopIntent("Cancel")).toBe(true);
    expect(isUserStopIntent("abort")).toBe(true);
    expect(isUserStopIntent("Stop the run")).toBe(true);
    expect(isUserStopIntent("please stop")).toBe(true);
  });

  it("rejects long or instructional messages", () => {
    expect(isUserStopIntent("Stop hooks from firing")).toBe(false);
    expect(isUserStopIntent("/fix-module aaac generic templates")).toBe(false);
    expect(isUserStopIntent("")).toBe(false);
  });
});
