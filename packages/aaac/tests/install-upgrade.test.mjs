import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { installAaac, upgradeAaac } from "../src/lib/install.mjs";

const PKG_ROOT = path.resolve(import.meta.dirname, "..");

describe("installAaac packageRoot + upgradeAaac", () => {
  it("writes install-manifest version from packageRoot", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-install-ver-"));
    try {
      installAaac({
        targetDir: root,
        projectName: "demo",
        packageRoot: PKG_ROOT,
      });
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(root, ".cursor/aaac/install-manifest.json"),
          "utf8",
        ),
      );
      const pkg = JSON.parse(
        fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"),
      );
      expect(manifest.package).toBe("@ludecker/aaac");
      expect(manifest.version).toBe(pkg.version);
      expect(fs.existsSync(path.join(root, ".cursor/aaac/runtime-registry.json"))).toBe(
        true,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves state/runs across upgrade", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-upgrade-state-"));
    try {
      installAaac({
        targetDir: root,
        projectName: "demo",
        packageRoot: PKG_ROOT,
      });
      const runPath = path.join(
        root,
        ".cursor/aaac/state/runs/run-keep/run.json",
      );
      fs.mkdirSync(path.dirname(runPath), { recursive: true });
      fs.writeFileSync(runPath, JSON.stringify({ run_id: "run-keep", ok: true }));

      upgradeAaac({
        targetDir: root,
        projectName: "demo",
        packageRoot: PKG_ROOT,
      });

      expect(fs.existsSync(runPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(runPath, "utf8")).run_id).toBe("run-keep");
      expect(fs.existsSync(path.join(root, ".cursor/aaac/install-manifest.json"))).toBe(
        true,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
