import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const REGISTRY_BASE = "https://registry.npmjs.org/@ludecker%2Faaac";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @param {string | null | undefined} cacheDir
 * @returns {string}
 */
export function resolveAaacCacheDir(cacheDir) {
  if (cacheDir && typeof cacheDir === "string" && cacheDir.trim()) {
    return path.resolve(cacheDir.trim());
  }
  return path.join(os.tmpdir(), "ludecker-aaac-cache");
}

/**
 * @param {string} [versionOrTag="latest"]
 * @param {{ fetchImpl?: typeof fetch; timeoutMs?: number }} [options]
 * @returns {Promise<{ version: string; tarballUrl: string }>}
 */
export async function resolveAaacNpmPackage(versionOrTag = "latest", options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available to resolve @ludecker/aaac from npm");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const tag = encodeURIComponent(String(versionOrTag || "latest"));
    const response = await fetchImpl(`${REGISTRY_BASE}/${tag}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`npm registry returned ${response.status} for @ludecker/aaac@${versionOrTag}`);
    }
    const data = await response.json();
    const version = typeof data.version === "string" ? data.version : null;
    const tarballUrl =
      typeof data.dist?.tarball === "string" ? data.dist.tarball : null;
    if (!version || !tarballUrl) {
      throw new Error("npm registry response missing version or dist.tarball");
    }
    return { version, tarballUrl };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} tarballUrl
 * @param {string} destPath
 * @param {{ fetchImpl?: typeof fetch; timeoutMs?: number }} [options]
 */
async function downloadFile(tarballUrl, destPath, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(tarballUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`tarball download failed with status ${response.status}`);
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    if (response.body && typeof response.body.getReader === "function") {
      // Node 18+ fetch body is a web ReadableStream
      await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath));
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} tarballPath
 * @param {string} extractDir
 */
export function extractNpmTarball(tarballPath, extractDir) {
  fs.mkdirSync(extractDir, { recursive: true });
  const result = spawnSync(
    "tar",
    ["-xzf", tarballPath, "-C", extractDir],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `tar extract failed: ${result.stderr || result.stdout || `exit ${result.status}`}`,
    );
  }
  const packageRoot = path.join(extractDir, "package");
  if (!fs.existsSync(path.join(packageRoot, "package.json"))) {
    throw new Error(`extracted tarball missing package/package.json at ${packageRoot}`);
  }
  return packageRoot;
}

/**
 * Download and extract @ludecker/aaac from npm into a versioned cache.
 *
 * @param {string} [versionOrTag="latest"]
 * @param {{
 *   cacheDir?: string | null;
 *   fetchImpl?: typeof fetch;
 *   timeoutMs?: number;
 * }} [options]
 * @returns {Promise<{ version: string; packageRoot: string; fromCache: boolean }>}
 */
export async function fetchAaacPackageFromNpm(versionOrTag = "latest", options = {}) {
  const meta = await resolveAaacNpmPackage(versionOrTag, options);
  const cacheRoot = resolveAaacCacheDir(options.cacheDir);
  const versionDir = path.join(cacheRoot, meta.version);
  const packageRoot = path.join(versionDir, "package");
  const marker = path.join(packageRoot, "package.json");

  if (fs.existsSync(marker)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(marker, "utf8"));
      if (pkg.name === "@ludecker/aaac" && pkg.version === meta.version) {
        return { version: meta.version, packageRoot, fromCache: true };
      }
    } catch {
      // re-download
    }
  }

  fs.rmSync(versionDir, { recursive: true, force: true });
  fs.mkdirSync(versionDir, { recursive: true });

  const tarballPath = path.join(versionDir, "aaac.tgz");
  await downloadFile(meta.tarballUrl, tarballPath, options);
  extractNpmTarball(tarballPath, versionDir);
  fs.rmSync(tarballPath, { force: true });

  return { version: meta.version, packageRoot, fromCache: false };
}
