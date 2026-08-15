import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_AAAC_MODEL_SLUG,
  isAllowedAaacModelSlug,
  resolveAaacPhaseModel,
  toCursorCliModelSlug,
} from "../src/aaac-model.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("aaac-model", () => {
  it("rejects non-Grok providers", () => {
    expect(isAllowedAaacModelSlug("grok-4.6-fast")).toBe(true);
    expect(isAllowedAaacModelSlug("composer-2.5-fast")).toBe(false);
    expect(isAllowedAaacModelSlug("gpt-5.3-codex-high-fast")).toBe(false);
  });

  it("maps shorthand onto a Cursor CLI slug", () => {
    expect(toCursorCliModelSlug("grok-4.6-fast")).toBe("cursor-grok-4.6-medium-fast");
    expect(toCursorCliModelSlug("grok-4.6-high")).toBe("cursor-grok-4.6-high");
  });

  it("resolves a Grok 4.6 slug for execute", async () => {
    const slug = await resolveAaacPhaseModel(REPO_ROOT, { phase: "execute" });
    expect(isAllowedAaacModelSlug(slug)).toBe(true);
    expect(slug.startsWith("cursor-grok-4.6-")).toBe(true);
  });

  it("falls back to Grok 4.6 fast without a workspace", async () => {
    const slug = await resolveAaacPhaseModel("", { phase: "discover" });
    expect(slug).toBe(DEFAULT_AAAC_MODEL_SLUG);
    expect(slug).toBe("cursor-grok-4.6-medium-fast");
  });
});
