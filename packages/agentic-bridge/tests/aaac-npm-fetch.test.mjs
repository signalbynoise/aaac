import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import {
  extractNpmTarball,
  fetchAaacPackageFromNpm,
  resolveAaacCacheDir,
  resolveAaacNpmPackage,
} from "../src/aaac-npm-fetch.mjs";

function makeFixtureTarball(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-tar-src-"));
  const pkgDir = path.join(root, "package");
  fs.mkdirSync(path.join(pkgDir, "templates", "cursor", "aaac"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "@ludecker/aaac", version }, null, 2),
  );
  fs.writeFileSync(path.join(pkgDir, "templates", "cursor", "aaac", "marker.txt"), "ok");
  const tarball = path.join(root, "aaac.tgz");
  const packed = spawnSync("tar", ["-czf", tarball, "-C", root, "package"], {
    encoding: "utf8",
  });
  expect(packed.status).toBe(0);
  return { root, tarball, pkgDir };
}

describe("aaac-npm-fetch", () => {
  it("resolves cache dir from option or tmp", () => {
    expect(resolveAaacCacheDir("/tmp/custom-cache")).toBe(path.resolve("/tmp/custom-cache"));
    expect(resolveAaacCacheDir(null)).toContain("ludecker-aaac-cache");
  });

  it("resolves package metadata via fetchImpl", async () => {
    const meta = await resolveAaacNpmPackage("1.2.4", {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          version: "1.2.4",
          dist: { tarball: "https://example.test/aaac-1.2.4.tgz" },
        }),
      }),
    });
    expect(meta).toEqual({
      version: "1.2.4",
      tarballUrl: "https://example.test/aaac-1.2.4.tgz",
    });
  });

  it("extracts npm tarballs into package/", () => {
    const { root, tarball } = makeFixtureTarball("9.9.9");
    try {
      const extractDir = path.join(root, "out");
      const packageRoot = extractNpmTarball(tarball, extractDir);
      expect(fs.existsSync(path.join(packageRoot, "package.json"))).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version).toBe(
        "9.9.9",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("downloads and caches a package via mocked registry", async () => {
    const { root, tarball } = makeFixtureTarball("9.9.8");
    const cacheDir = path.join(root, "cache");
    const tarballBytes = fs.readFileSync(tarball);
    try {
      const fetchImpl = async (url) => {
        if (String(url).includes("registry.npmjs.org")) {
          return {
            ok: true,
            json: async () => ({
              version: "9.9.8",
              dist: { tarball: "https://example.test/aaac-9.9.8.tgz" },
            }),
          };
        }
        return {
          ok: true,
          arrayBuffer: async () => tarballBytes,
          body: null,
        };
      };

      const first = await fetchAaacPackageFromNpm("9.9.8", { cacheDir, fetchImpl });
      expect(first.version).toBe("9.9.8");
      expect(first.fromCache).toBe(false);
      expect(fs.existsSync(path.join(first.packageRoot, "templates", "cursor", "aaac", "marker.txt"))).toBe(
        true,
      );

      const second = await fetchAaacPackageFromNpm("9.9.8", { cacheDir, fetchImpl });
      expect(second.fromCache).toBe(true);
      expect(second.packageRoot).toBe(first.packageRoot);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
