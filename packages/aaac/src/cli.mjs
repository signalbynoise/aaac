#!/usr/bin/env node
import readline from "readline";
import path from "path";
import { parseArgs } from "./lib/paths.mjs";
import { installAaac, runGenerators } from "./lib/install.mjs";
import { resolveCursorRoot } from "./lib/paths.mjs";
import { runEngineScript } from "./lib/run-engine-paths.mjs";

function printHelp() {
  console.log(`@ludecker/aaac — Agentic Architecture as Code

Usage:
  npx @ludecker/aaac@latest init [options]
  pnpm dlx @ludecker/aaac@latest init [options]
  aaac generate [options]

Commands:
  init      Copy AAAC kernel into .cursor/ and docs/ (default)
  generate    Regenerate graph.yaml and commands from ontology
  log-dump    Print Run manifest log + decisions
  debug-run   One-shot Run status summary

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
  1. Enable Cursor Hooks (Settings → Hooks) and restart Cursor
  2. Open the project in Cursor
  3. Create ${options.docsRoot}/master_rules.md and ${options.docsRoot}/architecture.md if missing
  4. Try /review-architecture or /check-architecture
  5. Read ${options.docsRoot}/agentic_architecture.md — Part 2 for adding domains

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

function cmdLogDump(args, argv) {
  const targetDir = args.dir ? path.resolve(args.dir) : process.cwd();
  const passthrough = argv.filter((a) => a !== "log-dump" && a !== "--dir");
  const runIdx = passthrough.findIndex((a) => !a.startsWith("-"));
  if (runIdx === -1) {
    console.error("Usage: aaac log-dump <run_id> [--level debug] [--format timeline|json|pretty] [--dir <path>]");
    process.exit(1);
  }
  runEngineScript("log-dump.mjs", passthrough.slice(runIdx), targetDir);
}

function cmdDebugRun(args, argv) {
  const targetDir = args.dir ? path.resolve(args.dir) : process.cwd();
  const passthrough = argv.filter((a) => a !== "debug-run" && a !== "--dir");
  const runIdx = passthrough.findIndex((a) => !a.startsWith("-"));
  if (runIdx === -1) {
    console.error("Usage: aaac debug-run <run_id> [--json] [--dir <path>]");
    process.exit(1);
  }
  runEngineScript("debug-run.mjs", passthrough.slice(runIdx), targetDir);
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
  if (sub === "log-dump") {
    cmdLogDump(args, argv);
    return;
  }
  if (sub === "debug-run") {
    cmdDebugRun(args, argv);
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
