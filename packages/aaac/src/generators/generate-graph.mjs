#!/usr/bin/env node
/** Writes .cursor/aaac/graph.yaml from ontology + lifecycle + graph.project.yaml */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import {
  aaacDir,
  parseArgs,
  resolveCursorRoot,
  packageGeneratorsDir,
} from "../lib/paths.mjs";

const INJECT_MARKER = "{{INJECT_OBJECT_BLOCKS}}";

/** Drop `#` comment lines from graph.project.yaml — comments are not valid in merged graph.yaml tail. */
function stripProjectOverlayComments(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const args = parseArgs(process.argv);
const cursorRoot = resolveCursorRoot(args.root);
const aaac = aaacDir(cursorRoot);
const generatorsDir = packageGeneratorsDir();

const commandsBlock = execSync(
  `node "${path.join(generatorsDir, "generate-graph-commands.mjs")}" --root "${cursorRoot}"`,
  { encoding: "utf8" },
);

const data = JSON.parse(
  fs.readFileSync(path.join(aaac, "ontology.json"), "utf8"),
);

const lifecycle = JSON.parse(
  fs.readFileSync(path.join(aaac, "lifecycle/lifecycle.json"), "utf8"),
);

const gates = JSON.parse(
  fs.readFileSync(path.join(aaac, "governance/gates.json"), "utf8"),
);

const capabilityRegistry = JSON.parse(
  fs.readFileSync(path.join(aaac, "capabilities/registry.json"), "utf8"),
);

const projectTail = fs.readFileSync(
  path.join(aaac, "graph.project.yaml"),
  "utf8",
);

function providerSkillId(provider) {
  if (typeof provider === "string") return provider;
  if (provider.type === "skill") return provider.id;
  return null;
}

function resolveCapabilities(capIds) {
  const skills = new Set();
  for (const id of capIds ?? []) {
    const cap = capabilityRegistry.capabilities[id];
    if (!cap) throw new Error(`Unknown capability in ontology: ${id}`);
    for (const provider of cap.providers) {
      const skillId = providerSkillId(provider);
      if (skillId) skills.add(skillId);
    }
  }
  return [...skills];
}

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

const resolvedObjectSkills = Object.fromEntries(
  Object.entries(data.object_capabilities ?? {}).map(([object, caps]) => [
    object,
    resolveCapabilities(caps),
  ]),
);

const resolvedObjectSkillVerbs = Object.fromEntries(
  Object.entries(data.object_capability_verbs ?? {}).map(([object, verbs]) => [
    object,
    Object.fromEntries(
      Object.entries(verbs).map(([verb, caps]) => [
        verb,
        resolveCapabilities(caps),
      ]),
    ),
  ]),
);

const objectCapabilitiesBlock = Object.entries(data.object_capabilities ?? {})
  .map(([object, caps]) =>
    caps.length ? `  ${object}: [${caps.join(", ")}]` : `  ${object}: []`,
  )
  .join("\n");

const objectSkillsBlock = Object.entries(resolvedObjectSkills)
  .map(([object, skills]) =>
    skills.length ? `  ${object}: [${skills.join(", ")}]` : `  ${object}: []`,
  )
  .join("\n");

const objectSkillVerbsBlock = Object.entries(resolvedObjectSkillVerbs)
  .map(([object, verbs]) => {
    const inner = Object.entries(verbs)
      .map(([verb, skills]) =>
        skills.length
          ? `    ${verb}: [${skills.join(", ")}]`
          : `    ${verb}: []`,
      )
      .join("\n");
    return `  ${object}:\n${inner}`;
  })
  .join("\n");

const verbWorkPhasesBlock = Object.entries(lifecycle.verbs ?? {})
  .map(
    ([verb, def]) => `  ${verb}: [${(def.work_phases ?? []).join(", ")}]`,
  )
  .join("\n");

const verbGateStackBlock = Object.entries(lifecycle.verbs ?? {})
  .map(
    ([verb, def]) =>
      `  ${verb}: ${def.gate_stack ?? "null"}`,
  )
  .join("\n");

const verbRuntimeBlock = Object.entries(lifecycle.verbs ?? {})
  .map(([verb, def]) => {
    const phases = Array.isArray(def) ? def : composeRuntimePhases(def);
    return `  ${verb}: [${phases.join(", ")}]`;
  })
  .join("\n");

const governanceGateStacksBlock = Object.entries(gates.stacks ?? {})
  .map(([name, phases]) => `  ${name}: [${phases.join(", ")}]`)
  .join("\n");

const commandWorkflowsBlock = Object.entries(lifecycle.workflows ?? {})
  .map(([cmd, def]) => {
    const phases = composeRuntimePhases(def);
    return `  ${cmd}: [${phases.join(", ")}]`;
  })
  .join("\n");

const layerComment = Object.entries(data.layers ?? {})
  .sort((a, b) => a[1].order - b[1].order)
  .map(([name, L]) => `#   ${name}: ${L.objects.join(", ")}`)
  .join("\n");

const confidenceBlock = Object.entries(data.confidence ?? {})
  .map(([k, v]) => `  ${k}: ${v}`)
  .join("\n");

const objectMaturityBlock = Object.entries(data.object_maturity ?? {})
  .map(([object, level]) => `  ${object}: ${level}`)
  .join("\n");

const maturityRulesBlock = Object.entries(data.maturity_rules ?? {})
  .map(([level, rule]) => {
    const phases = (rule.requires_phases ?? [])
      .map((p) => `      - ${p}`)
      .join("\n");
    return `  ${level}:\n    requires_phases:\n${phases || "      []"}\n    investigation: ${rule.investigation ?? "lite_on_create_update_deep_on_fix"}`;
  })
  .join("\n");

const injectBlock = `object_capabilities:
${objectCapabilitiesBlock}

object_skills:
${objectSkillsBlock}

object_skill_verbs:
${objectSkillVerbsBlock}
`;

const header = `version: 1

# AAAC execution graph — SSOT for command → orchestrator → skills → agents.
# Regenerate: pnpm aaac:generate (or npx @ludecker/aaac generate)
# Path convention: agents/, policies/, skills/, domains/ are relative to .cursor/
# Ontology: .cursor/aaac/ontology.json — layers (code → data → product → system):
${layerComment}

verbs: [${Object.keys(data.verbs).join(", ")}]
objects: [${Object.keys(data.objects).join(", ")}]

invalid_pairs:
${data.invalid_pairs.map(([v, o]) => `  - [${v}, ${o}]`).join("\n")}

verb_work_phases:
${verbWorkPhasesBlock}

verb_gate_stack:
${verbGateStackBlock}

governance_gate_stacks:
${governanceGateStacksBlock}

# Composed runtime: work through plan + gate stack + execute onward (see lifecycle.json runtime_compose)
verb_runtime:
${verbRuntimeBlock}

# Exception commands — not verb×object; use for Run.pending when command matches
command_workflows:
${commandWorkflowsBlock}

confidence:
${confidenceBlock}

object_maturity:
${objectMaturityBlock}

maturity_rules:
${maturityRulesBlock}

# Layer SSOT refs (see aaac/layers.md)
lifecycle: aaac/lifecycle/lifecycle.json
lifecycle_phases: aaac/lifecycle/phases.json
governance_gates: aaac/governance/gates.json
complexity: aaac/complexity.yaml
run: aaac/run/schema.json
capabilities: aaac/capabilities/registry.json
dependencies: aaac/dependencies.yaml
fitness_functions: aaac/fitness-functions.yaml
state: aaac/state/runs/
observability: aaac/run/schema.json
contracts: aaac/contracts/

`;

let tail = stripProjectOverlayComments(projectTail.trim());
if (tail.includes(INJECT_MARKER)) {
  tail = tail.replace(INJECT_MARKER, injectBlock.trim());
} else {
  tail = `${tail}\n\n${injectBlock.trim()}`;
}

const out = `${header}${commandsBlock}\n\n${tail}\n`;
fs.writeFileSync(path.join(aaac, "graph.yaml"), out);
console.log("Wrote graph.yaml");

const registryScript = path.join(aaac, "scripts", "generate-runtime-registry.mjs");
if (fs.existsSync(registryScript)) {
  execSync(`${process.execPath} "${registryScript}"`, { stdio: "inherit" });
}
