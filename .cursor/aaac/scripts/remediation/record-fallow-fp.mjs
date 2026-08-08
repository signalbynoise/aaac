#!/usr/bin/env node
/**
 * Record swarm/check-risk false-positive or protected findings into campaign SSOT.
 *
 * Usage:
 *   node record-fallow-fp.mjs --campaign-id <id> --path <file> \
 *     --classification false_positive|review|true_positive \
 *     [--export <name>] [--reason <text>] [--source check-risk] [--iteration <n>]
 *
 * Batch:
 *   node record-fallow-fp.mjs --campaign-id <id> --from-json <entries.json>
 */
import fs from "fs";
import path from "path";
import { REPO_ROOT, isoNow, readJson, writeJson } from "../run-engine/lib.mjs";

const CAMPAIGNS_ROOT = path.join(REPO_ROOT, ".cursor/aaac/state/campaigns");

function parseArgs(argv) {
  const out = {
    campaignId: null,
    filePath: null,
    exportName: null,
    classification: null,
    reason: "",
    source: "check-risk",
    iteration: null,
    fromJson: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--campaign-id") out.campaignId = argv[++i];
    else if (a === "--path") out.filePath = argv[++i];
    else if (a === "--export") out.exportName = argv[++i];
    else if (a === "--classification") out.classification = argv[++i];
    else if (a === "--reason") out.reason = argv[++i];
    else if (a === "--source") out.source = argv[++i];
    else if (a === "--iteration") out.iteration = Number(argv[++i]);
    else if (a === "--from-json") out.fromJson = argv[++i];
  }
  return out;
}

function normalizePath(p) {
  return p.replace(/^frontend\//, "").replace(/^\//, "");
}

function entryId(filePath, exportName) {
  const p = normalizePath(filePath);
  return exportName ? `path:${p}:export:${exportName}` : `path:${p}`;
}

const args = parseArgs(process.argv.slice(2));
if (!args.campaignId) {
  console.error("record-fallow-fp: --campaign-id required");
  process.exit(2);
}

const campaignDir = path.join(CAMPAIGNS_ROOT, args.campaignId);
const registryPath = path.join(campaignDir, "fallow-false-positives.json");
const registry = readJson(registryPath, { version: 1, entries: [] });

let newEntries = [];
if (args.fromJson) {
  const batch = readJson(args.fromJson, { entries: [] });
  newEntries = batch.entries ?? batch;
} else if (args.filePath && args.classification) {
  newEntries = [
    {
      path: normalizePath(args.filePath),
      export_name: args.exportName ?? null,
      classification: args.classification,
      reason: args.reason || args.source,
      source: args.source,
      iteration: args.iteration,
    },
  ];
} else {
  console.error("record-fallow-fp: --path + --classification or --from-json required");
  process.exit(2);
}

for (const e of newEntries) {
  const id = e.id ?? entryId(e.path, e.export_name);
  const record = {
    id,
    path: normalizePath(e.path),
    export_name: e.export_name ?? null,
    classification: e.classification ?? "false_positive",
    reason: e.reason ?? "manual",
    source: e.source ?? args.source,
    iteration: e.iteration ?? args.iteration,
    recorded_at: isoNow(),
  };
  registry.entries = (registry.entries ?? []).filter((x) => x.id !== id);
  registry.entries.push(record);
}

registry.updated_at = isoNow();
writeJson(registryPath, registry);

fs.appendFileSync(
  path.join(campaignDir, "journal.md"),
  `\n- **Fallow FP registry** +${newEntries.length} entries (total ${registry.entries.length})\n`,
);

console.log(JSON.stringify({ ok: true, added: newEntries.length, total: registry.entries.length }));
