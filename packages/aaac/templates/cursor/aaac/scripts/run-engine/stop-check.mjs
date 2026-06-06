#!/usr/bin/env node
import path from "path";
import {
  loadActiveRun,
  loadRunManifest,
  conversationIdFromHook,
  runDir,
  writeJson,
  isoNow,
} from "./lib.mjs";
import { recordLog } from "./log.mjs";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let hook = {};
  try {
    hook = JSON.parse(input || "{}");
  } catch {
    process.exit(0);
  }

  const conversationId = conversationIdFromHook(hook);
  if (!conversationId) process.exit(0);

  const active = loadActiveRun(conversationId);
  if (!active?.run_id) process.exit(0);

  const manifest = loadRunManifest(active.run_id);
  if (!manifest || manifest.status === "completed") process.exit(0);

  const remaining = [manifest.phase, ...(manifest.pending ?? [])].filter(Boolean);

  recordLog(manifest, {
    event: "run_incomplete",
    phase: manifest.phase,
    phase_kind: manifest.phase_kind,
    detail: `stop hook: status=${manifest.status} remaining=${remaining.join("→")}`,
    level: "warn",
  });
  manifest.updated_at = isoNow();
  writeJson(path.join(runDir(active.run_id), "run.json"), manifest);

  console.log(
    JSON.stringify({
      followup_message: [
        `AAAC Run ${active.run_id} incomplete (this chat). Phase: ${manifest.phase}.`,
        `Remaining: ${remaining.join(" → ")}`,
        `Advance: node .cursor/aaac/scripts/run-engine/advance-phase.mjs ${active.run_id} ${manifest.phase}`,
        `Debug: node .cursor/aaac/scripts/run-engine/debug-run.mjs ${active.run_id}`,
      ].join("\n"),
    }),
  );
});
