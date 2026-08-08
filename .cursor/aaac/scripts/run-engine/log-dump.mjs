#!/usr/bin/env node
/**
 * Dump Run manifest log + decisions.
 * Usage: log-dump.mjs <run_id> [--level debug] [--format timeline|json|pretty]
 */
import { loadRunManifest } from "./lib.mjs";
import { filterLogByLevel, formatTimeline } from "./log.mjs";

function parseArgs(argv) {
  const args = { runId: null, level: "debug", format: "timeline" };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--level" && argv[i + 1]) {
      args.level = argv[++i];
    } else if (arg === "--format" && argv[i + 1]) {
      args.format = argv[++i];
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  args.runId = positional[0];
  return args;
}

const args = parseArgs(process.argv);

if (!args.runId) {
  console.error("Usage: log-dump.mjs <run_id> [--level debug] [--format timeline|json|pretty]");
  process.exit(1);
}

const manifest = loadRunManifest(args.runId);
if (!manifest) {
  console.error(`Run not found: ${args.runId}`);
  process.exit(1);
}

const filteredLog = filterLogByLevel(manifest.log ?? [], args.level);

if (args.format === "json") {
  console.log(
    JSON.stringify(
      {
        run_id: manifest.run_id,
        command: manifest.command,
        verb: manifest.verb,
        status: manifest.status,
        phase: manifest.phase,
        log: filteredLog,
        decisions: manifest.decisions ?? [],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (args.format === "pretty") {
  console.log(`Run: ${manifest.run_id}  /${manifest.command}  status=${manifest.status}  phase=${manifest.phase}`);
  console.log(`Log entries (level>=${args.level}): ${filteredLog.length}`);
  console.log("--- log ---");
  for (const e of filteredLog) {
    const skill = e.skill ? ` skill=${e.skill}` : "";
    console.log(`${e.at} [${e.level ?? "info"}] ${e.phase} :: ${e.event}${skill} — ${e.detail}`);
  }
  console.log("--- decisions ---");
  for (const d of manifest.decisions ?? []) {
    console.log(`${d.at} ${d.phase} :: ${d.decision} — ${d.reason}`);
    if (d.evidence) console.log(`  evidence: ${d.evidence}`);
  }
  process.exit(0);
}

console.log(formatTimeline({ ...manifest, log: filteredLog }, { minLevel: args.level }));
