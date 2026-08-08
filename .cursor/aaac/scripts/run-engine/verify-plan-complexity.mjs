#!/usr/bin/env node
/**
 * Verify plan.yaml complexity_score matches weighted sum of create[] kinds.
 * Usage: node verify-plan-complexity.mjs --run-id <id>
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { AAAC_ROOT, runDir, loadRunManifest, writeJson, isoNow } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadComplexityWeights() {
  const complexityPath = path.join(AAAC_ROOT, "complexity.yaml");
  if (!fs.existsSync(complexityPath)) return {};
  try {
    const require = createRequire(import.meta.url);
    const pkgRoot = path.resolve(__dirname, "../..");
    const yaml = require(require.resolve("yaml", { paths: [pkgRoot] }));
    const parsed = yaml.parse(fs.readFileSync(complexityPath, "utf8"));
    return parsed.scoring?.weights ?? {};
  } catch {
    return {};
  }
}

function parseCreateKinds(planContent) {
  const kinds = [];
  const createMatch = planContent.match(/^create:\s*$/m);
  if (!createMatch) return kinds;

  const lines = planContent.split("\n");
  const start = lines.findIndex((l) => /^create:\s*$/.test(l));
  if (start < 0) return kinds;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim()) break;
    const kindMatch = line.match(/^\s+kind:\s*(\S+)/);
    if (kindMatch) kinds.push(kindMatch[1]);
  }
  return kinds;
}

function readDeclaredScore(planContent) {
  const match = planContent.match(/^complexity_score:\s*(-?\d+(?:\.\d+)?)/m);
  return match ? Number(match[1]) : null;
}

function parseArgs(argv) {
  const out = { runId: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run-id") out.runId = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.runId) {
  console.error("Usage: verify-plan-complexity.mjs --run-id <run_id>");
  process.exit(2);
}

const manifest = loadRunManifest(args.runId);
if (!manifest) {
  console.error(`Run not found: ${args.runId}`);
  process.exit(1);
}

const planPath = path.join(runDir(args.runId), "artifacts/plan.yaml");
if (!fs.existsSync(planPath)) {
  console.error("Missing artifacts/plan.yaml");
  process.exit(1);
}

const planContent = fs.readFileSync(planPath, "utf8");
const weights = loadComplexityWeights();
const kinds = parseCreateKinds(planContent);
let computed = 0;
const breakdown = {};

for (const kind of kinds) {
  const w = weights[kind] ?? 1;
  breakdown[kind] = (breakdown[kind] ?? 0) + w;
  computed += w;
}

const declared = readDeclaredScore(planContent);
const delta = declared == null ? computed : Math.abs(computed - declared);
const verified = delta === 0;

manifest.complexity = {
  ...(manifest.complexity ?? {}),
  plan_score_verified: verified,
  plan_score_computed: computed,
  plan_score_declared: declared,
};
manifest.updated_at = isoNow();
writeJson(path.join(runDir(args.runId), "run.json"), manifest);

if (!verified) {
  console.error(
    `Plan complexity mismatch: declared=${declared} computed=${computed} delta=${delta}`,
  );
  process.exit(2);
}

console.log(
  JSON.stringify({
    ok: true,
    run_id: args.runId,
    declared,
    computed,
    breakdown,
  }),
);
