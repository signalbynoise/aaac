#!/usr/bin/env node
/** Emit .cursor/aaac/runtime-registry.json from ontology + lifecycle — SSOT for hooks */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const aaac = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const ontology = JSON.parse(
  fs.readFileSync(path.join(aaac, "ontology.json"), "utf8"),
);
const lifecycle = JSON.parse(
  fs.readFileSync(path.join(aaac, "lifecycle/lifecycle.json"), "utf8"),
);
const phases = JSON.parse(
  fs.readFileSync(path.join(aaac, "lifecycle/phases.json"), "utf8"),
);
const gates = JSON.parse(
  fs.readFileSync(path.join(aaac, "governance/gates.json"), "utf8"),
);

function composeRuntimePhases(verbDef) {
  const work = verbDef.work_phases ?? [];
  if (!verbDef.gate_stack) return work;
  const gatePhases = gates.stacks[verbDef.gate_stack] ?? [];
  const executeIdx = work.indexOf("execute");
  if (executeIdx === -1) {
    const reportIdx = work.indexOf("report");
    if (reportIdx <= 0) {
      return work.length <= 1
        ? [...work, ...gatePhases]
        : [...work.slice(0, -1), ...gatePhases, work[work.length - 1]];
    }
    return [...work.slice(0, reportIdx), ...gatePhases, ...work.slice(reportIdx)];
  }
  return [...work.slice(0, executeIdx), ...gatePhases, ...work.slice(executeIdx)];
}

const gatePhases = {};
for (const [id, def] of Object.entries(phases.phases ?? {})) {
  if (def.gate) gatePhases[id] = true;
}

const commands = {};
const aliases = { ...(ontology.command_aliases ?? {}) };

for (const [cmd, entry] of Object.entries(ontology.command_overrides ?? {})) {
  if (entry.alias) continue;
  let pending;
  let gate_stack = null;
  if (lifecycle.workflows?.[cmd]) {
    pending = composeRuntimePhases(lifecycle.workflows[cmd]);
    gate_stack = lifecycle.workflows[cmd].gate_stack ?? null;
  } else {
    const verb = cmd.split("-")[0];
    const verbDef = lifecycle.verbs?.[verb];
    if (verbDef) {
      pending = composeRuntimePhases(verbDef);
      gate_stack = verbDef.gate_stack ?? null;
    }
  }
  if (!pending) continue;
  commands[cmd] = {
    verb: cmd.split("-")[0],
    object: cmd.includes("-") ? cmd.split("-").slice(1).join("-") : null,
    orchestrator: entry.orchestrator ?? entry.resolver ?? null,
    resolver: entry.resolver ?? null,
    pending,
    gate_stack,
  };
}

for (const verb of Object.keys(ontology.verbs ?? {})) {
  for (const object of Object.keys(ontology.objects ?? {})) {
    const cmd = `${verb}-${object}`;
    if (commands[cmd]) continue;
    if (
      (ontology.invalid_pairs ?? []).some(([v, o]) => v === verb && o === object)
    ) {
      continue;
    }
    const verbDef = lifecycle.verbs?.[verb];
    if (!verbDef) continue;
    commands[cmd] = {
      verb,
      object,
      orchestrator: verb === "check" ? "verb-check" : `verb-${verb}`,
      pending: composeRuntimePhases(verbDef),
      gate_stack: verbDef.gate_stack ?? null,
    };
  }
}

for (const [alias, canonical] of Object.entries(aliases)) {
  if (commands[canonical] && !commands[alias]) {
    commands[alias] = { ...commands[canonical], alias_of: canonical };
  }
}

const out = {
  version: 1,
  generated_at: new Date().toISOString(),
  aliases,
  gate_phases: gatePhases,
  commands,
};

fs.writeFileSync(
  path.join(aaac, "runtime-registry.json"),
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log(`Wrote runtime-registry.json (${Object.keys(commands).length} commands)`);
