#!/usr/bin/env node
/** Prints graph.yaml `commands:` block from ontology.json */
import fs from "fs";
import path from "path";
import { aaacDir, parseArgs, resolveCursorRoot } from "../lib/paths.mjs";

const args = parseArgs(process.argv);
const cursorRoot = resolveCursorRoot(args.root);
const aaac = aaacDir(cursorRoot);

const data = JSON.parse(
  fs.readFileSync(path.join(aaac, "ontology.json"), "utf8"),
);
const { verbs, objects, invalid_pairs, command_overrides, command_aliases } =
  data;
const invalid = new Set(invalid_pairs.map(([v, o]) => `${v}-${o}`));

const lines = ["commands:"];
const done = new Set();

function emit(cmd, entry) {
  done.add(cmd);
  if (entry.alias) {
    lines.push(`  ${cmd}:`);
    lines.push(`    alias: ${entry.alias}`);
    return;
  }
  if (entry.resolver) {
    lines.push(`  ${cmd}:`);
    lines.push(`    resolver: ${entry.resolver}`);
    return;
  }
  if (entry.orchestrator) {
    lines.push(`  ${cmd}:`);
    lines.push(`    orchestrator: ${entry.orchestrator}`);
    if (entry.object) lines.push(`    object: ${entry.object}`);
  }
}

for (const [cmd, entry] of Object.entries(command_overrides)) {
  emit(cmd, entry);
}

for (const verb of Object.keys(verbs)) {
  for (const object of Object.keys(objects)) {
    const cmd = `${verb}-${object}`;
    if (invalid.has(cmd) || done.has(cmd)) continue;
    done.add(cmd);
    const orch = verb === "check" ? "verb-check" : `verb-${verb}`;
    lines.push(`  ${cmd}:`);
    lines.push(`    orchestrator: ${orch}`);
    lines.push(`    object: ${object}`);
  }
}

for (const [alias, canonical] of Object.entries(command_aliases ?? {})) {
  if (done.has(alias) || alias === canonical) continue;
  done.add(alias);
  lines.push(`  ${alias}:`);
  lines.push(`    alias: ${canonical}`);
}

console.log(lines.join("\n"));
