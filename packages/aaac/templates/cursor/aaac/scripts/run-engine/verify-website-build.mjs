#!/usr/bin/env node
/**
 * Verify website static assets + production build.
 * Used by advance-phase on create/update/fix verify completion.
 *
 * Usage:
 *   node verify-website-build.mjs [--run-id <run_id>] [--skip-build]
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { REPO_ROOT, runDir, isoNow, writeJson } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.join(REPO_ROOT, "apps/website");
const INDEX_HTML = path.join(WEBSITE_ROOT, "index.html");

const args = process.argv.slice(2);
const runIdIdx = args.indexOf("--run-id");
const runId = runIdIdx >= 0 ? args[runIdIdx + 1] : null;
const skipBuild = args.includes("--skip-build");

const results = {
  status: "pass",
  checked_at: isoNow(),
  static_assets: { status: "pass", missing: [] },
  build: { status: skipBuild ? "skipped" : "pending", command: "pnpm --filter @ludecker/website build" },
};

function fail(section, detail) {
  results.status = "fail";
  if (section === "static_assets") {
    results.static_assets.status = "fail";
    results.static_assets.missing.push(detail);
  } else if (section === "build") {
    results.build.status = "fail";
    results.build.detail = detail;
  }
  console.error(`[verify-website-build] FAIL ${section}: ${detail}`);
}

function resolveRootAsset(assetPath) {
  const rel = assetPath.replace(/^\//, "");
  const candidates = [
    path.join(WEBSITE_ROOT, "public", rel),
    path.join(WEBSITE_ROOT, rel),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function checkStaticAssets() {
  if (!fs.existsSync(INDEX_HTML)) {
    fail("static_assets", `missing index.html at ${INDEX_HTML}`);
    return;
  }

  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const rootRefs = [
    ...html.matchAll(/\b(?:href|src)="(\/[^"#?]+)"/g),
  ].map((match) => match[1]);

  const seen = new Set();
  for (const ref of rootRefs) {
    if (seen.has(ref) || ref.startsWith("//")) continue;
    seen.add(ref);

    const resolved = resolveRootAsset(ref);
    if (!resolved) {
      fail(
        "static_assets",
        `${ref} not found under apps/website/public/ or apps/website/ (Vite dev resolves root paths to project root)`,
      );
    }
  }
}

function runBuild() {
  if (skipBuild) return;

  const proc = spawnSync(
    "pnpm",
    ["--filter", "@ludecker/website", "build"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    },
  );

  if (proc.status !== 0) {
    const detail = [proc.stderr, proc.stdout].filter(Boolean).join("\n").trim();
    results.build.status = "fail";
    results.build.exit_code = proc.status ?? 1;
    fail("build", detail || `exit ${proc.status}`);
    return;
  }

  results.build.status = "pass";
  results.build.exit_code = 0;
}

function writeArtifact() {
  if (!runId) return;

  const artifactDir = path.join(runDir(runId), "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });

  const yaml = [
    `status: ${results.status}`,
    `checked_at: ${results.checked_at}`,
    "static_assets:",
    `  status: ${results.static_assets.status}`,
    `  missing: ${JSON.stringify(results.static_assets.missing)}`,
    "build:",
    `  status: ${results.build.status}`,
    `  command: ${JSON.stringify(results.build.command)}`,
    results.build.exit_code != null ? `  exit_code: ${results.build.exit_code}` : null,
    results.build.detail ? `  detail: ${JSON.stringify(results.build.detail)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  fs.writeFileSync(path.join(artifactDir, "verify.yaml"), `${yaml}\n`);

  const manifestPath = path.join(runDir(runId), "run.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.artifacts = manifest.artifacts ?? {};
    manifest.artifacts.verify = results;
    manifest.updated_at = isoNow();
    writeJson(manifestPath, manifest);
  } catch {
    // run.json may not exist in standalone invocations
  }
}

checkStaticAssets();
runBuild();
writeArtifact();

console.log(JSON.stringify({ ok: results.status === "pass", ...results }));
process.exit(results.status === "pass" ? 0 : 1);
