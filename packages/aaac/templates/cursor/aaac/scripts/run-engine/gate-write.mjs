#!/usr/bin/env node
/** preToolUse — deny code edits outside execute phase for THIS chat only. */
import path from "path";
import {
  loadActiveRun,
  loadRunManifest,
  loadEnforcement,
  isEditPhase,
  isArtifactPath,
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
  const deny = (userMessage, agentMessage, detail) => {
    console.log(JSON.stringify({ permission: "deny", user_message: userMessage, agent_message: agentMessage }));
    process.exit(0);
  };
  const allow = () => {
    console.log(JSON.stringify({ permission: "allow" }));
    process.exit(0);
  };

  const persistEditEvent = (manifest, runId, event, detail) => {
    recordLog(manifest, {
      event,
      phase: manifest.phase,
      phase_kind: manifest.phase_kind,
      detail,
      level: "debug",
    });
    manifest.updated_at = isoNow();
    writeJson(path.join(runDir(runId), "run.json"), manifest);
  };

  let hook;
  try {
    hook = JSON.parse(input || "{}");
  } catch {
    allow();
  }

  const toolName = hook.tool_name ?? hook.toolName ?? "";
  if (!/^(Write|StrReplace|Delete|EditNotebook|ApplyPatch)$/i.test(toolName)) allow();

  const conversationId = conversationIdFromHook(hook);
  if (!conversationId) allow();

  const active = loadActiveRun(conversationId);
  if (
    !active?.run_id ||
    active.status === "completed" ||
    active.status === "cancelled"
  ) {
    allow();
  }

  const manifest = loadRunManifest(active.run_id);
  if (
    !manifest ||
    manifest.status === "completed" ||
    manifest.status === "cancelled"
  ) {
    allow();
  }
  if (manifest.conversation_id && manifest.conversation_id !== conversationId) allow();

  const enforcement = loadEnforcement();
  const filePath =
    hook.tool_input?.path ?? hook.toolInput?.path ?? hook.tool_input?.file_path ?? hook.arguments?.path ?? "";

  if (filePath && isArtifactPath(filePath, enforcement)) {
    persistEditEvent(manifest, active.run_id, "edit_allowed", `artifact path: ${filePath}`);
    allow();
  }

  if (manifest.awaiting_approval || manifest.status === "blocked") {
    persistEditEvent(manifest, active.run_id, "edit_denied", `blocked at gate: ${manifest.blocked_reason ?? "approval"}`);
    deny(`AAAC Run ${active.run_id} blocked at gate.`, `Run blocked. Run: ${active.run_id}`);
  }

  if (isEditPhase(manifest.phase, enforcement)) {
    persistEditEvent(manifest, active.run_id, "edit_allowed", `${toolName} in phase ${manifest.phase}`);
    allow();
  }
  if (enforcement.artifact_write_phases?.includes(manifest.phase) && filePath) {
    persistEditEvent(manifest, active.run_id, "edit_allowed", `artifact_write phase ${manifest.phase}`);
    allow();
  }

  persistEditEvent(
    manifest,
    active.run_id,
    "edit_denied",
    `${toolName} blocked in phase ${manifest.phase}${filePath ? `: ${filePath}` : ""}`,
  );
  deny(
    `AAAC: edits blocked in phase "${manifest.phase}" (this chat). Run: ${active.run_id}`,
    `Cannot ${toolName} during "${manifest.phase}". Chat ${conversationId}. Advance phase first.`,
  );
});
