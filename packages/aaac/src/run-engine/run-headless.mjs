#!/usr/bin/env node
/**
 * Official headless AAAC run-to-completion.
 * Dispatches a Run via the package run-engine, then drives phases with cursor-agent
 * until completed / failed / cancelled.
 *
 * Usage (via CLI):
 *   aaac run "/fix-module eval \"intent\"" --dir <path> [--auto-approve] [--json]
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRunEngineScript } from "../lib/run-engine-paths.mjs";
import {
  DEFAULT_AAAC_MODEL_SLUG,
  isAllowedAaacModelSlug,
} from "./load-model-routing.mjs";
import { resolveModelForPhase } from "./resolve-model-for-phase.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveCursorBin() {
  if (process.env.CURSOR_BIN && fs.existsSync(process.env.CURSOR_BIN)) {
    return process.env.CURSOR_BIN;
  }
  const mac =
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";
  if (fs.existsSync(mac)) return mac;
  const home = process.env.HOME || "";
  for (const cand of [
    `${home}/.local/bin/agent`,
    `${home}/.local/bin/cursor-agent`,
    `${home}/.local/bin/cursor`,
  ]) {
    if (fs.existsSync(cand)) return cand;
  }
  return "agent";
}

function cursorAgentArgv(bin, agentArgs) {
  const base = String(bin).split("/").pop();
  if (base === "agent" || base === "cursor-agent") return [...agentArgs];
  return ["agent", ...agentArgs];
}

function runEngineCapture(scriptName, argv, targetDir) {
  const scriptPath = resolveRunEngineScript(scriptName, targetDir);
  const result = spawnSync(process.execPath, [scriptPath, ...argv], {
    cwd: targetDir,
    env: { ...process.env, AAAC_WORKSPACE_ROOT: targetDir },
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function readManifest(targetDir, runId) {
  const p = path.join(
    targetDir,
    ".cursor",
    "aaac",
    "state",
    "runs",
    runId,
    "manifest.json",
  );
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function listCompletedPhases(manifest) {
  return Array.isArray(manifest?.completed) ? manifest.completed : [];
}

async function tryPhaseRunner(targetDir, runId, { autoApprove }) {
  try {
    const bridge = await import("@ludecker/agentic-bridge");
    if (!bridge?.PhaseRunner) {
      console.error("[aaac run] @ludecker/agentic-bridge PhaseRunner missing");
      return null;
    }
    const runner = new bridge.PhaseRunner(targetDir);
    if (autoApprove) {
      runner.on("approval-required", ({ runId: id }) => {
        // Persist approval (incl. capability_runtime_approved) before unblocking the runner.
        runEngineCapture(
          "approve-run.mjs",
          [id, "--approve", "--reason", "aaac run --auto-approve"],
          targetDir,
        );
        runner.resolveApproval(id, true, "aaac run --auto-approve");
      });
    }
    await runner.executeRun(runId);
    return readManifest(targetDir, runId);
  } catch (err) {
    console.error(
      "[aaac run] PhaseRunner failed, will fall back to cursor drive:",
      err?.stack || err?.message || err,
    );
    return null;
  }
}

function runCursorOnce({ workdir, prompt, model, timeoutMs }) {
  const bin = resolveCursorBin();
  const agentArgs = [
    "-p",
    "-f",
    "--trust",
    "--approve-mcps",
    "--workspace",
    workdir,
    "--output-format",
    "text",
    "--model",
    model,
  ];
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (apiKey) {
    agentArgs.push("--api-key", apiKey);
  }
  agentArgs.push(prompt);
  const args = cursorAgentArgv(bin, agentArgs);
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: workdir,
      env: { ...process.env, CI: "1", CURSOR_MODEL: model },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, timedOut: true, stdout, stderr });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false, stdout, stderr });
    });
  });
}

function ensurePhaseArtifact(targetDir, runId, phase) {
  const artDir = path.join(
    targetDir,
    ".cursor",
    "aaac",
    "state",
    "runs",
    runId,
    "artifacts",
  );
  fs.mkdirSync(artDir, { recursive: true });
  const marker = path.join(artDir, `${phase}.md`);
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(
      marker,
      `# ${phase}\n\nHeadless aaac run phase note.\n`,
      "utf8",
    );
  }
}

async function driveWithCursorAgent(targetDir, runId, {
  model,
  autoApprove,
  timeoutMs,
  maxPhases = 40,
}) {
  for (let i = 0; i < maxPhases; i += 1) {
    const manifest = readManifest(targetDir, runId);
    if (!manifest) throw new Error(`Run not found: ${runId}`);
    if (manifest.status === "completed") return manifest;
    if (manifest.status === "failed" || manifest.status === "cancelled") {
      return manifest;
    }
    if (manifest.awaiting_approval || manifest.status === "blocked") {
      if (!autoApprove) {
        throw new Error(
          `Run ${runId} blocked awaiting approval (pass --auto-approve)`,
        );
      }
      const approve = runEngineCapture(
        "approve-run.mjs",
        [runId, "--approve", "--reason", "aaac run --auto-approve"],
        targetDir,
      );
      if (approve.status !== 0) {
        throw new Error(
          `approve-run failed: ${approve.stderr || approve.stdout}`,
        );
      }
      continue;
    }
    const phase = manifest.phase;
    if (!phase) {
      throw new Error(`Run ${runId} has no current phase`);
    }
    const resolved = resolveModelForPhase({ phase });
    const phaseModel = isAllowedAaacModelSlug(resolved?.model_slug)
      ? resolved.model_slug
      : isAllowedAaacModelSlug(model)
        ? model
        : DEFAULT_AAAC_MODEL_SLUG;
    const prompt = [
      "You are executing an AAAC Run phase headlessly.",
      `Run: ${runId}`,
      `Phase: ${phase}`,
      `Command: ${manifest.command ?? ""}`,
      `Intent: ${manifest.intent ?? ""}`,
      "Follow AAAC phase contracts for this workspace.",
      "Make the minimal correct changes for this phase, write required artifacts under .cursor/aaac/state/runs/, then stop.",
      "Do not advance phases yourself.",
    ].join("\n");
    await runCursorOnce({
      workdir: targetDir,
      prompt,
      model: phaseModel,
      timeoutMs,
    });
    ensurePhaseArtifact(targetDir, runId, phase);
    const advance = runEngineCapture(
      "advance-phase.mjs",
      [runId, phase],
      targetDir,
    );
    const refreshed = readManifest(targetDir, runId);
    if (refreshed?.completed?.includes(phase)) continue;
    if (refreshed?.awaiting_approval) continue;
    if (advance.status !== 0 && refreshed?.status === "failed") {
      return refreshed;
    }
    if (advance.status !== 0) {
      // force-fail closed
      runEngineCapture(
        "reconcile-run-status.mjs",
        [runId],
        targetDir,
      );
      const after = readManifest(targetDir, runId);
      if (after?.status === "completed") return after;
      if (listCompletedPhases(after).includes(phase)) continue;
      throw new Error(
        `advance-phase failed for ${phase}: ${advance.stderr || advance.stdout}`,
      );
    }
  }
  throw new Error(`Run ${runId} exceeded max phases (${maxPhases})`);
}

/**
 * @returns {Promise<{ ok: boolean, run_id: string, status: string, manifest: object }>}
 */
export async function runAaacHeadless(prompt, {
  targetDir = process.cwd(),
  autoApprove = false,
  model = DEFAULT_AAAC_MODEL_SLUG,
  timeoutMs = Number(process.env.AAAC_RUN_TIMEOUT_MS || 1_800_000),
  json = false,
} = {}) {
  const abs = path.resolve(targetDir);
  if (!fs.existsSync(path.join(abs, ".cursor", "aaac"))) {
    throw new Error(
      `AAAC not installed in ${abs}. Run: npx @ludecker/aaac init --yes --dir ${abs}`,
    );
  }

  const dispatched = runEngineCapture(
    "dispatch-run.mjs",
    [prompt, "--json"],
    abs,
  );
  let payload;
  try {
    payload = JSON.parse((dispatched.stdout || "").trim().split("\n").pop());
  } catch {
    throw new Error(
      `dispatch-run did not return JSON: ${dispatched.stderr || dispatched.stdout}`,
    );
  }
  if (!payload?.ok || !payload.run_id) {
    throw new Error(payload?.error || "dispatch-run failed");
  }
  const runId = payload.run_id;

  let finalManifest = await tryPhaseRunner(abs, runId, { autoApprove });
  if (
    !finalManifest ||
    (finalManifest.status !== "completed" &&
      finalManifest.status !== "failed" &&
      finalManifest.status !== "cancelled")
  ) {
    finalManifest = await driveWithCursorAgent(abs, runId, {
      model,
      autoApprove,
      timeoutMs,
    });
  }

  finalManifest = finalManifest || readManifest(abs, runId);
  const status = finalManifest?.status || "unknown";
  const result = {
    ok: status === "completed",
    aaac: true,
    run_id: runId,
    status,
    phase: finalManifest?.phase ?? null,
    command: finalManifest?.command ?? null,
    origin: "aaac-run",
  };
  if (json) {
    console.log(JSON.stringify(result));
  }
  if (status !== "completed") {
    const err = new Error(`AAAC run ${runId} ended with status=${status}`);
    err.result = result;
    throw err;
  }
  return { ...result, manifest: finalManifest };
}

// CLI entry when executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const autoApprove = args.includes("--auto-approve");
  const dirIdx = args.indexOf("--dir");
  const targetDir =
    dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : process.cwd();
  const prompt = args
    .filter(
      (a, i) =>
        !a.startsWith("-") &&
        a !== args[dirIdx + 1] &&
        !(dirIdx >= 0 && i === dirIdx + 1),
    )
    .join(" ")
    .trim();
  if (!prompt) {
    console.error(
      'Usage: node run-headless.mjs "/command domain \\"intent\\"" [--dir path] [--auto-approve] [--json]',
    );
    process.exit(1);
  }
  runAaacHeadless(prompt, { targetDir, autoApprove, json })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}
