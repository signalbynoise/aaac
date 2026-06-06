#!/usr/bin/env node
import readline from "readline";
import path from "path";
import { parseArgs } from "./lib/paths.mjs";
import { installAaac, runGenerators } from "./lib/install.mjs";
import { resolveCursorRoot } from "./lib/paths.mjs";

function printHelp() {
  console.log(`@ludecker/aaac — Agentic Architecture as Code

Usage:
  npx @ludecker/aaac@latest init [options]
  pnpm dlx @ludecker/aaac@latest init [options]
  aaac generate [options]

Commands:
  init      Copy AAAC kernel into .cursor/ and docs/ (default)
  generate  Regenerate graph.yaml and commands from ontology

Options:
  --dir <path>   Target project directory (default: cwd)
  --yes, -y      Non-interactive defaults
  --force        Backup existing .cursor/ and replace

Install (no npm CLI required):
  npx @ludecker/aaac@latest init
  pnpm dlx @ludecker/aaac@latest init

Docs: https://ludecker.com/guide/install-aaac
Package: https://www.npmjs.com/package/@ludecker/aaac
`);
}

function ask(question, defaultValue) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const prompt = defaultValue
    ? `${question} [${defaultValue}]: `
    : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed || defaultValue || "");
    });
  });
}

async function promptInitOptions(args) {
  if (args.yes) {
    const dir = args.dir ? path.resolve(args.dir) : process.cwd();
    const base = path.basename(dir);
    return {
      targetDir: dir,
      projectName: base || "my-project",
      docsRoot: "docs",
    };
  }

  const targetDir = args.dir
    ? path.resolve(args.dir)
    : await ask("Project directory", process.cwd());
  const projectName = await ask(
    "Project name",
    path.basename(targetDir) || "my-project",
  );
  const docsRoot = await ask("Docs folder (relative to project)", "docs");

  return { targetDir, projectName, docsRoot };
}

async function cmdInit(args) {
  const options = await promptInitOptions(args);
  console.log(`\nInstalling AAAC into ${options.targetDir}...\n`);

  const { cursorDest, docsDest } = installAaac({
    targetDir: options.targetDir,
    projectName: options.projectName,
    docsRoot: options.docsRoot,
    force: args.force,
  });

  console.log(`
AAAC installed.

  .cursor/     → ${cursorDest}
  docs/        → ${docsDest}

Next steps:
  1. Open the project in Cursor
  2. Create ${options.docsRoot}/master_rules.md and ${options.docsRoot}/architecture.md if missing
  3. Try /review-architecture or /check-architecture
  4. Read ${options.docsRoot}/agentic_architecture.md — Part 2 for adding domains

Regenerate after ontology changes:
  pnpm dlx @ludecker/aaac@latest generate
  npx @ludecker/aaac@latest generate
`);
}

function cmdGenerate(args) {
  const targetDir = args.dir ? path.resolve(args.dir) : process.cwd();
  const cursorRoot = resolveCursorRoot(path.join(targetDir, ".cursor"));
  console.log(`Regenerating AAAC graph at ${cursorRoot}...`);
  runGenerators(cursorRoot);
  console.log("Done.");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const args = parseArgs(process.argv);
  const sub = argv.find((a) => !a.startsWith("-")) ?? "init";

  if (sub === "init") {
    await cmdInit(args);
    return;
  }
  if (sub === "generate") {
    cmdGenerate(args);
    return;
  }

  console.error(`Unknown command: ${sub}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
