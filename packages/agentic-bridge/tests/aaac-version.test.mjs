import { describe, it, expect } from "vitest";
import { compareSemver, parseSemver } from "../src/aaac-version.mjs";

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("0.0.0", "0.0.0")).toBe(0);
  });

  it("compares major versions", () => {
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
  });

  it("compares minor versions when major is equal", () => {
    expect(compareSemver("1.3.0", "1.2.9")).toBe(1);
    expect(compareSemver("1.1.0", "1.2.0")).toBe(-1);
  });

  it("compares patch versions when major and minor are equal", () => {
    expect(compareSemver("1.2.4", "1.2.3")).toBe(1);
    expect(compareSemver("1.2.1", "1.2.3")).toBe(-1);
  });

  it("treats release versions as newer than prerelease versions", () => {
    expect(compareSemver("1.2.3", "1.2.3-beta")).toBe(1);
    expect(compareSemver("1.2.3-beta", "1.2.3")).toBe(-1);
  });

  it("compares prerelease identifiers left to right", () => {
    expect(compareSemver("1.2.3-beta.2", "1.2.3-beta.1")).toBe(1);
    expect(compareSemver("1.2.3-beta.1", "1.2.3-beta.2")).toBe(-1);
    expect(compareSemver("1.2.3-alpha", "1.2.3-beta")).toBe(-1);
  });

  it("compares numeric prerelease identifiers numerically", () => {
    expect(compareSemver("1.2.3-beta.10", "1.2.3-beta.2")).toBe(1);
  });

  it("returns -1 when the first version is invalid", () => {
    expect(compareSemver("invalid", "1.0.0")).toBe(-1);
    expect(parseSemver("invalid")).toBeNull();
  });

  it("returns 1 when the second version is invalid", () => {
    expect(compareSemver("1.0.0", "invalid")).toBe(1);
  });
});
