#!/usr/bin/env node
/**
 * Verify app static assets + production build (project overlay).
 * Skips when `.cursor/aaac/project.config.json` has `verify.enabled: false`.
 *
 * Usage:
 *   node verify-website-build.mjs [--run-id <run_id>] [--skip-build]
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { runDir, isoNow, writeJson, readJson } from "./lib.mjs";

const PROJECT_ROOT = process.cwd();

const args = process.argv.slice(2);
const runIdIdx = args.indexOf("--run-id");
const runId = runIdIdx >= 0 ? args[runIdIdx + 1] : null;
const skipBuild = args.includes("--skip-build");

function loadVerifyConfig() {
  const configPath = path.join(PROJECT_ROOT, ".cursor/aaac/project.config.json");
  const config = readJson(configPath, { verify: { enabled: false } });
  const verify = config.verify ?? { enabled: false };
  if (!verify.enabled) {
    return { enabled: false };
  }
  const appRootRel = verify.app_root ?? "apps/web";
  const indexRel =
    verify.index_html ?? path.join(appRootRel, "index.html").replace(/\\/g, "/");
  const appRoot = path.join(PROJECT_ROOT, appRootRel);
  const indexHtml = path.join(PROJECT_ROOT, indexRel);
  const build = verify.build ?? { command: "pnpm", args: ["run", "build"] };
  return { enabled: true, appRoot, indexHtml, build, appRootRel };
}

const verifyConfig = loadVerifyConfig();

const results = {
  status: "pass",
  checked_at: isoNow(),
  static_assets: { status: "pass", missing: [] },
  build: {
    status: skipBuild ? "skipped" : "pending",
    command: null,
  },
  verify_config: verifyConfig.enabled ? "enabled" : "disabled",
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

function resolveRootAsset(assetPath, websiteRoot, appRootRel) {
  const rel = assetPath.replace(/^\//, "");
  const candidates = [
    path.join(websiteRoot, "public", rel),
    path.join(websiteRoot, rel),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function checkStaticAssets(indexHtml, websiteRoot, appRootRel) {
  if (!fs.existsSync(indexHtml)) {
    fail("static_assets", `missing index.html at ${indexHtml}`);
    return;
  }

  const html = fs.readFileSync(indexHtml, "utf8");
  const rootRefs = [
    ...html.matchAll(/\b(?:href|src)="(\/[^"#?]+)"/g),
  ].map((match) => match[1]);

  const seen = new Set();
  for (const ref of rootRefs) {
    if (seen.has(ref) || ref.startsWith("//")) continue;
    seen.add(ref);

    const resolved = resolveRootAsset(ref, websiteRoot, appRootRel);
    if (!resolved) {
      fail(
        "static_assets",
        `${ref} not found under ${appRootRel}/public/ or ${appRootRel}/`,
      );
    }
  }
}

function runBuild(build) {
  if (skipBuild) return;

  const command = build.command ?? "pnpm";
  const buildArgs = build.args ?? ["run", "build"];
  results.build.command = [command, ...buildArgs].join(" ");

  const proc = spawnSync(command, buildArgs, {
    cwd: build.cwd ? path.join(PROJECT_ROOT, build.cwd) : PROJECT_ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });

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
    `verify_config: ${results.verify_config}`,
    "static_assets:",
    `  status: ${results.static_assets.status}`,
    `  missing: ${JSON.stringify(results.static_assets.missing)}`,
    "build:",
    `  status: ${results.build.status}`,
    results.build.command ? `  command: ${JSON.stringify(results.build.command)}` : null,
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

if (!verifyConfig.enabled) {
  results.static_assets.status = "skipped";
  results.build.status = "skipped";
  results.build.command = null;
  writeArtifact();
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "verify.disabled", ...results }));
  process.exit(0);
}

results.build.command = skipBuild
  ? null
  : [verifyConfig.build.command, ...(verifyConfig.build.args ?? [])].join(" ");

checkStaticAssets(
  verifyConfig.indexHtml,
  verifyConfig.appRoot,
  verifyConfig.appRootRel,
);
runBuild(verifyConfig.build);
writeArtifact();

console.log(JSON.stringify({ ok: results.status === "pass", ...results }));
process.exit(results.status === "pass" ? 0 : 1);
