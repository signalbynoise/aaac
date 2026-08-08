import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { installAaac } from "../../aaac/src/lib/install.mjs";
import {
  ensureAaacCurrent,
  resolveAaacEnsureAction,
} from "../src/install-workspace.mjs";

const PKG_ROOT = path.resolve(import.meta.dirname, "../../aaac");

function makeFixtureTarball(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-ensure-tar-"));
  const pkgDir = path.join(root, "package");
  // Use real package content for upgrade to keep generators working
  fs.cpSync(PKG_ROOT, pkgDir, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}node_modules${path.sep}`),
  });
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  pkg.version = version;
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const tarball = path.join(root, "aaac.tgz");
  const packed = spawnSync("tar", ["-czf", tarball, "-C", root, "package"], {
    encoding: "utf8",
  });
  expect(packed.status).toBe(0);
  return { root, tarball };
}

function mockFetchForTarball(version, tarballPath) {
  const tarballBytes = fs.readFileSync(tarballPath);
  return async (url) => {
    if (String(url).includes("registry.npmjs.org")) {
      return {
        ok: true,
        json: async () => ({
          version,
          dist: { tarball: `https://example.test/aaac-${version}.tgz` },
        }),
      };
    }
    return {
      ok: true,
      arrayBuffer: async () => tarballBytes,
      body: null,
    };
  };
}

describe("resolveAaacEnsureAction", () => {
  it("installs when missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-missing-"));
    try {
      const decision = resolveAaacEnsureAction(root, {
        bundledVersion: "1.2.4",
        installedVersion: null,
        latestVersion: "1.2.4",
        updateAvailable: true,
        npmCheckFailed: false,
      });
      expect(decision.action).toBe("install");
      expect(decision.reason).toBe("missing");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips dogfood trees without install-manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-dogfood-"));
    try {
      installAaac({ targetDir: root, projectName: "demo", packageRoot: PKG_ROOT });
      fs.rmSync(path.join(root, ".cursor/aaac/install-manifest.json"));
      const decision = resolveAaacEnsureAction(root, {
        bundledVersion: "1.2.4",
        installedVersion: null,
        latestVersion: "1.2.5",
        updateAvailable: true,
        npmCheckFailed: false,
      });
      expect(decision).toMatchObject({ action: "skip", reason: "dogfood" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("upgrades when installed version is behind npm", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-behind-"));
    try {
      installAaac({ targetDir: root, projectName: "demo", packageRoot: PKG_ROOT });
      fs.writeFileSync(
        path.join(root, ".cursor/aaac/install-manifest.json"),
        `${JSON.stringify({
          package: "@ludecker/aaac",
          version: "1.2.0",
          installed_at: new Date().toISOString(),
        }, null, 2)}\n`,
      );
      const decision = resolveAaacEnsureAction(root, {
        bundledVersion: "1.2.4",
        installedVersion: "1.2.0",
        latestVersion: "1.2.4",
        updateAvailable: true,
        npmCheckFailed: false,
      });
      expect(decision).toMatchObject({ action: "upgrade", reason: "behind" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips when npm is unavailable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-offline-"));
    try {
      installAaac({ targetDir: root, projectName: "demo", packageRoot: PKG_ROOT });
      const decision = resolveAaacEnsureAction(root, {
        bundledVersion: "1.2.4",
        installedVersion: "1.2.0",
        latestVersion: null,
        updateAvailable: false,
        npmCheckFailed: true,
      });
      expect(decision).toMatchObject({ action: "skip", reason: "npm-unavailable" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ensureAaacCurrent", () => {
  it("upgrades a behind install from mocked npm and preserves state", async () => {
    const { root: tarRoot, tarball } = makeFixtureTarball("1.2.9");
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-ensure-ws-"));
    const cacheDir = path.join(workspace, ".cache");
    try {
      installAaac({ targetDir: workspace, projectName: "demo", packageRoot: PKG_ROOT });
      const stateFile = path.join(
        workspace,
        ".cursor/aaac/state/runs/keep-me/run.json",
      );
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ run_id: "keep-me" }));
      fs.writeFileSync(
        path.join(workspace, ".cursor/aaac/install-manifest.json"),
        `${JSON.stringify({
          package: "@ludecker/aaac",
          version: "1.2.0",
          installed_at: new Date().toISOString(),
        }, null, 2)}\n`,
      );

      const result = await ensureAaacCurrent(workspace, {
        cacheDir,
        fetchImpl: mockFetchForTarball("1.2.9", tarball),
        skipIncompleteRunCheck: true,
      });

      expect(result.updated).toBe(true);
      expect(result.action).toBe("upgrade");
      expect(result.toVersion).toBe("1.2.9");
      expect(fs.existsSync(stateFile)).toBe(true);
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(workspace, ".cursor/aaac/install-manifest.json"),
          "utf8",
        ),
      );
      expect(manifest.version).toBe("1.2.9");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(tarRoot, { recursive: true, force: true });
    }
  });

  it("skips dogfood without mutating the tree", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-ensure-dog-"));
    try {
      installAaac({ targetDir: workspace, projectName: "demo", packageRoot: PKG_ROOT });
      fs.rmSync(path.join(workspace, ".cursor/aaac/install-manifest.json"));
      const before = fs.readFileSync(
        path.join(workspace, ".cursor/aaac/enforcement.json"),
        "utf8",
      );

      const result = await ensureAaacCurrent(workspace, {
        fetchImpl: async () => {
          throw new Error("should not fetch for dogfood");
        },
        skipIncompleteRunCheck: true,
      });

      expect(result).toMatchObject({ updated: false, action: "skip", reason: "dogfood" });
      expect(
        fs.readFileSync(path.join(workspace, ".cursor/aaac/enforcement.json"), "utf8"),
      ).toBe(before);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
