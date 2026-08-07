import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildDevDepInstallArgs,
  detectPackageManager,
  formatExternalPrerequisitesConsole,
  formatExternalPrerequisitesMarkdown,
  isNpmPackageInstalled,
  loadExternalPrerequisites,
  promptAndInstallPrerequisites,
} from "../src/lib/external-prerequisites.mjs";
import { formatInstallSweepReport } from "../src/lib/sweep-project-docs.mjs";

describe("external-prerequisites", () => {
  it("loads catalog with Fallow recommended and installable", () => {
    const catalog = loadExternalPrerequisites();
    expect(catalog.prerequisites.length).toBeGreaterThan(0);
    const fallow = catalog.prerequisites.find((p) => p.id === "fallow");
    expect(fallow).toMatchObject({
      tier: "recommended",
      installable: true,
      install: { kind: "npm-devdep", package: "fallow" },
    });
    const hooks = catalog.prerequisites.find((p) => p.id === "cursor-hooks");
    expect(hooks.installable).toBe(false);
  });

  it("formats markdown and console output", () => {
    const catalog = loadExternalPrerequisites();
    const md = formatExternalPrerequisitesMarkdown(catalog, [
      { id: "fallow", status: "installed", detail: "pnpm add -D fallow" },
    ]);
    expect(md).toContain("## External prerequisites");
    expect(md).toContain("Fallow");
    expect(md).toContain("installed");

    const consoleText = formatExternalPrerequisitesConsole(catalog);
    expect(consoleText).toContain("RECOMMENDED:");
    expect(consoleText).toContain("Fallow");
    expect(consoleText).toContain("[can install]");
  });

  it("detects package manager from lockfiles", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-pm-"));
    try {
      expect(detectPackageManager(root)).toBe("npm");
      fs.writeFileSync(path.join(root, "yarn.lock"), "");
      expect(detectPackageManager(root)).toBe("yarn");
      fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
      expect(detectPackageManager(root)).toBe("pnpm");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds real install args (not npx fallow)", () => {
    expect(buildDevDepInstallArgs("pnpm", "fallow")).toEqual([
      "add",
      "-D",
      "fallow",
    ]);
    expect(buildDevDepInstallArgs("npm", "fallow")).toEqual([
      "install",
      "--save-dev",
      "fallow",
    ]);
  });

  it("detects installed packages from package.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-dep-"));
    try {
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "x",
          devDependencies: { fallow: "^1.0.0" },
        }),
      );
      expect(isNpmPackageInstalled(root, "fallow")).toBe(true);
      expect(isNpmPackageInstalled(root, "@playwright/test")).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips installable deps when non-interactive", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-skip-"));
    let installCalled = false;
    try {
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "x", private: true }),
      );
      const { outcomes } = await promptAndInstallPrerequisites(root, {
        interactive: false,
        installFn: () => {
          installCalled = true;
          return { ok: true, command: "nope", packageManager: "npm" };
        },
      });
      expect(installCalled).toBe(false);
      expect(
        outcomes.some(
          (o) => o.id === "fallow" && o.status === "skipped_noninteractive",
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("installs Fallow when ask answers Yes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-yes-"));
    const calls = [];
    try {
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "x", private: true }),
      );
      const { outcomes } = await promptAndInstallPrerequisites(root, {
        interactive: true,
        askFn: async () => "Y",
        installFn: (dir, pkg) => {
          calls.push({ dir, pkg });
          return {
            ok: true,
            packageManager: "npm",
            command: `npm install --save-dev ${pkg}`,
          };
        },
      });
      expect(calls.some((c) => c.pkg === "fallow")).toBe(true);
      expect(
        outcomes.some((o) => o.id === "fallow" && o.status === "installed"),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes External prerequisites in sweep report", () => {
    const catalog = loadExternalPrerequisites();
    const md = formatInstallSweepReport({
      before: { docs: [], rules: [], framework: [] },
      after: {
        docs: ["docs/a.md"],
        rules: [],
        framework: [".cursor/aaac/dispatch.md"],
      },
      docsRoot: "docs",
      projectName: "x",
      installedAt: "2026-01-01T00:00:00.000Z",
      prerequisitesCatalog: catalog,
    });
    expect(md).toContain("## External prerequisites");
    expect(md).toContain("Fallow");
    expect(md).toContain("Cursor Hooks");
  });
});
