import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/@ludecker/aaac/latest";
const NPM_TIMEOUT_MS = 8000;

const bridgeRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {Object} ParsedSemver
 * @property {number} major
 * @property {number} minor
 * @property {number} patch
 * @property {string | null} prerelease
 * @property {string | null} build
 * @property {string} raw
 */

/**
 * @typedef {Object} AaacVersionInfo
 * @property {string | null} bundledVersion
 * @property {string | null} installedVersion
 * @property {string | null} latestVersion
 * @property {boolean} updateAvailable
 * @property {boolean} npmCheckFailed
 */

/**
 * @param {string | null | undefined} version
 * @returns {ParsedSemver | null}
 */
export function parseSemver(version) {
  if (!version || typeof version !== "string") return null;
  const trimmed = version.trim();
  const match = trimmed.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/,
  );
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    build: match[5] ?? null,
    raw: trimmed,
  };
}

/**
 * @param {string | ParsedSemver | null | undefined} a
 * @param {string | ParsedSemver | null | undefined} b
 * @returns {-1 | 0 | 1}
 */
export function compareSemver(a, b) {
  const va = typeof a === "string" ? parseSemver(a) : a;
  const vb = typeof b === "string" ? parseSemver(b) : b;

  if (!va && !vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;

  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;

  if (!va.prerelease && vb.prerelease) return 1;
  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && !vb.prerelease) return 0;

  const aParts = va.prerelease.split(".");
  const bParts = vb.prerelease.split(".");
  const len = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    const ap = aParts[i];
    const bp = bParts[i];
    if (ap === undefined) return -1;
    if (bp === undefined) return 1;

    const an = Number(ap);
    const bn = Number(bp);
    const aIsNum = !Number.isNaN(an) && String(an) === ap;
    const bIsNum = !Number.isNaN(bn) && String(bn) === bp;

    if (aIsNum && bIsNum) {
      if (an !== bn) return an < bn ? -1 : 1;
      continue;
    }
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    if (ap !== bp) return ap < bp ? -1 : 1;
  }

  return 0;
}

/**
 * @returns {string | null}
 */
export function readBundledAaacVersion() {
  try {
    const pkgPath = path.join(bridgeRoot, "node_modules", "@ludecker", "aaac", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} workspaceRoot
 * @returns {string | null}
 */
export function readInstalledAaacVersion(workspaceRoot) {
  try {
    const manifestPath = path.join(
      path.resolve(workspaceRoot),
      ".cursor",
      "aaac",
      "install-manifest.json",
    );
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ version: string | null; failed: boolean }>}
 */
export async function fetchLatestAaacVersionFromNpm() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NPM_TIMEOUT_MS);

    try {
      const response = await fetch(NPM_REGISTRY_URL, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        return { version: null, failed: true };
      }

      const data = await response.json();
      return {
        version: typeof data.version === "string" ? data.version : null,
        failed: false,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { version: null, failed: true };
  }
}

/**
 * @param {string} workspaceRoot
 * @returns {AaacVersionInfo}
 */
export function resolveAaacVersionInfo(workspaceRoot) {
  return {
    bundledVersion: readBundledAaacVersion(),
    installedVersion: readInstalledAaacVersion(workspaceRoot),
    latestVersion: null,
    updateAvailable: false,
    npmCheckFailed: false,
  };
}

/**
 * @param {string} workspaceRoot
 * @returns {Promise<AaacVersionInfo>}
 */
export async function checkAaacVersionUpdate(workspaceRoot) {
  const info = resolveAaacVersionInfo(workspaceRoot);
  const npmResult = await fetchLatestAaacVersionFromNpm();

  info.latestVersion = npmResult.version;
  info.npmCheckFailed = npmResult.failed;

  const compareVersion = info.installedVersion ?? info.bundledVersion;
  if (compareVersion && info.latestVersion && !npmResult.failed) {
    info.updateAvailable = compareSemver(compareVersion, info.latestVersion) < 0;
  }

  return info;
}
