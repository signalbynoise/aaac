#!/usr/bin/env node
/**
 * Regenerates .cursor/commands/<verb>-<object>.md from ontology.json
 * Prunes stale command files. manual_commands from aaac/project.config.json
 */
import fs from "fs";
import path from "path";
import { aaacDir, parseArgs, resolveCursorRoot } from "../lib/paths.mjs";

const args = parseArgs(process.argv);
const cursorRoot = resolveCursorRoot(args.root);
const aaac = aaacDir(cursorRoot);
const commandsDir = path.join(cursorRoot, "commands");
fs.mkdirSync(commandsDir, { recursive: true });

const data = JSON.parse(
  fs.readFileSync(path.join(aaac, "ontology.json"), "utf8"),
);

const projectConfigPath = path.join(aaac, "project.config.json");
const projectConfig = fs.existsSync(projectConfigPath)
  ? JSON.parse(fs.readFileSync(projectConfigPath, "utf8"))
  : { manual_commands: [] };

const {
  verbs,
  objects,
  invalid_pairs,
  command_overrides,
  command_aliases,
} = data;

const invalid = new Set(invalid_pairs.map(([v, o]) => `${v}-${o}`));

const KEEP_EXTRA = new Set(projectConfig.manual_commands ?? []);

const CONTENT_WRITER_CANONICAL = "write-article";

function isContentWriter(cmd, entry) {
  const canonical = entry?.alias ?? cmd;
  return canonical === CONTENT_WRITER_CANONICAL;
}

function writeContentWriterCmd(cmd, entry = null) {
  const aliasLine =
    cmd !== CONTENT_WRITER_CANONICAL
      ? `\n\n> Alias → \`/${CONTENT_WRITER_CANONICAL}\`. See [write-article.md](write-article.md).\n`
      : "";
  const body = `# ${cmd}

CMS writer — research swarm + agents, any \`article_type\`, persist to Supabase.${aliasLine}

## Syntax

\`\`\`text
/${CONTENT_WRITER_CANONICAL} <type>, <title> [flags]
\`\`\`

Types: \`article\`, \`guide\`, \`skill\`, \`tool\`, \`command\`, \`subagent\`, \`diagram\`

Flags: \`--publish\`, \`--dry-run\`, \`--update\`, \`--tags "a, b"\`

## Dispatch

1. [.cursor/aaac/dispatch.md](../aaac/dispatch.md)
2. [.cursor/aaac/graph.yaml](../aaac/graph.yaml) — **\`${CONTENT_WRITER_CANONICAL}\`**
3. Run workflow \`write-article\` → [domains/content/write/orchestrator](../domains/content/write/orchestrator/SKILL.md)
4. [write-article skill](../skills/write-article/SKILL.md)

Full reference: [write-article.md](write-article.md)
`;
  fs.writeFileSync(path.join(commandsDir, `${cmd}.md`), body);
}

const EXCEPTION_CMD = {
  "fix-bug": {
    layer: "product",
    description: "defect repair (resolver; not in 12-object matrix)",
  },
  "review-incident": {
    layer: "system",
    description: "production incident investigation",
  },
};

function objectMeta(object, cmd) {
  if (EXCEPTION_CMD[cmd]) return EXCEPTION_CMD[cmd];
  const o = objects[object];
  if (!o) return { layer: null, description: object };
  if (typeof o === "string") return { layer: null, description: o };
  return { layer: o.layer ?? null, description: o.description ?? object };
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function orchestratorHint(cmd, entry) {
  if (entry?.alias) return `alias → \`${entry.alias}\``;
  if (entry?.resolver) {
    const fallback =
      cmd === "fix-bug"
        ? " — unknown slug → `verb-fix` + object `feature`"
        : "";
    return `resolver \`${entry.resolver}\`${fallback}`;
  }
  const verb = cmd.split("-")[0];
  const orch = entry?.orchestrator;
  const dedicated = new Set([
    "update-doc",
    "review-module",
    "review-incident",
    "test-function",
    "release-app",
    "write-article",
  ]);
  if (cmd === "update-architecture" || (orch && dedicated.has(orch))) {
    const id = cmd === "update-architecture" ? "update-doc" : orch;
    return `orchestrator \`${id}\` (see graph \`orchestrators.${id}.path\`)`;
  }
  const object = cmd.split("-").slice(1).join("-");
  return `[skills/shared/verbs/${verb}/orchestrator/SKILL.md](../skills/shared/verbs/${verb}/orchestrator/SKILL.md) (object: \`${object}\`)`;
}

function domainLine(cmd) {
  if (cmd === "review-incident" || cmd.endsWith("-function")) {
    return "Domain optional.";
  }
  if (cmd.endsWith("-domain") || cmd.endsWith("-module")) {
    return "Domain slug required (bounded context).";
  }
  return "Domain slug recommended.";
}

function writeCmd(cmd, entry = null) {
  if (isContentWriter(cmd, entry)) {
    writeContentWriterCmd(cmd, entry);
    return;
  }
  const parts = cmd.split("-");
  const verb = parts[0];
  let object = parts.slice(1).join("-");
  const vDesc = verbs[verb] ?? verb;
  if (entry?.alias) {
    const canonParts = entry.alias.split("-");
    object = canonParts.slice(1).join("-");
  }
  const { layer, description } = objectMeta(object, entry?.alias ?? cmd);
  const aliasNote = entry?.alias
    ? ` (alias \`${cmd}\` → \`${entry.alias}\`)`
    : "";
  const domainArg =
    cmd === "review-incident" || cmd.endsWith("-function") ? "" : " <domain>";
  const layerLine = layer ? `**Layer:** ${layer}  \n` : "";
  const body = `# ${cmd}

AAAC: \`/${cmd}${domainArg} "<intent>"\`

${layerLine}**${cap(vDesc)}** a **${object}**${aliasNote} — ${description}.

## Dispatch

1. [.cursor/aaac/dispatch.md](../aaac/dispatch.md)
2. [.cursor/aaac/graph.yaml](../aaac/graph.yaml) — **\`${cmd}\`**
3. ${orchestratorHint(cmd, entry ?? {})}

${domainLine(cmd)}
`;
  fs.writeFileSync(path.join(commandsDir, `${cmd}.md`), body);
}

const written = new Set();

for (const [cmd, entry] of Object.entries(command_overrides)) {
  if (KEEP_EXTRA.has(`${cmd}.md`)) continue;
  writeCmd(cmd, entry);
  written.add(cmd);
}

for (const [alias, canonical] of Object.entries(command_aliases ?? {})) {
  if (written.has(alias)) continue;
  writeCmd(alias, { alias: canonical });
  written.add(alias);
}

for (const verb of Object.keys(verbs)) {
  for (const object of Object.keys(objects)) {
    const cmd = `${verb}-${object}`;
    if (invalid.has(cmd) || written.has(cmd)) continue;
    writeCmd(cmd, { orchestrator: `verb-${verb}`, object });
    written.add(cmd);
  }
}

let pruned = 0;
if (fs.existsSync(commandsDir)) {
  for (const file of fs.readdirSync(commandsDir)) {
    if (!file.endsWith(".md") || KEEP_EXTRA.has(file)) continue;
    if (!written.has(file.replace(/\.md$/, ""))) {
      fs.unlinkSync(path.join(commandsDir, file));
      pruned++;
    }
  }
} else {
  fs.mkdirSync(commandsDir, { recursive: true });
}

console.log(`Wrote ${written.size} command files, pruned ${pruned} stale.`);
