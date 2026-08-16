import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(__dirname, "../src/run-engine/gate-read-budget.mjs");

function setupWorkspace() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-gate-"));
  const runId = "run_gate_sidecar";
  const aaac = path.join(tmp, ".cursor/aaac");
  fs.mkdirSync(path.join(aaac, "state/runs", runId, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(aaac, "state/active-runs"), { recursive: true });
  fs.writeFileSync(path.join(aaac, "runtime-registry.json"), JSON.stringify({ commands: {}, phases: {} }));
  fs.writeFileSync(path.join(aaac, "enforcement.json"), JSON.stringify({ edit_phases: ["execute"] }));
  fs.writeFileSync(
    path.join(aaac, "state/runs", runId, "run.json"),
    JSON.stringify({
      run_id: runId,
      status: "active",
      phase: "discover",
      command: "/check architecture",
      swarm: { agents: [] },
    }),
  );
  fs.writeFileSync(
    path.join(aaac, "state/runs", runId, "artifacts/phase_context.json"),
    JSON.stringify({
      experience: {
        repo_memory: {
          focus_paths: ["apps/foo/known.ts"],
          meta: { read_budgets: { max_agent_files_read: 6, max_full_file_opens: 2 } },
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(aaac, "state/active-runs/cli-latest.json"),
    JSON.stringify({ run_id: runId, phase: "discover", written_at: new Date().toISOString() }),
  );
  return { tmp, runId };
}

function runGate(workspace, hook, extraEnv = {}) {
  const result = spawnSync(process.execPath, [GATE], {
    cwd: workspace,
    env: {
      ...process.env,
      AAAC_WORKSPACE_ROOT: workspace,
      ...extraEnv,
    },
    input: JSON.stringify(hook),
    encoding: "utf8",
  });
  let parsed = null;
  try {
    parsed = JSON.parse((result.stdout || "").trim().split("\n").pop());
  } catch {
    parsed = { raw: result.stdout, stderr: result.stderr };
  }
  return { parsed, stderr: result.stderr || "", status: result.status };
}

describe("gate-read-budget sidecar", () => {
  it("denies unknown Read when only cli-latest sidecar identifies the run", () => {
    const { tmp } = setupWorkspace();
    const { parsed } = runGate(
      tmp,
      {
        tool_name: "Read",
        tool_input: { path: "apps/foo/unknown.ts" },
      },
      { AAAC_RUN_ID: "" },
    );
    expect(parsed.permission).toBe("deny");
    expect(String(parsed.agent_message || parsed.user_message)).toMatch(/packet|graph-native/i);
  });

  it("allows Read of a packet path", () => {
    const { tmp } = setupWorkspace();
    const { parsed } = runGate(tmp, {
      tool_name: "Read",
      tool_input: { path: "apps/foo/known.ts", offset: 1, limit: 20 },
    });
    expect(parsed.permission).toBe("allow");
  });

  it("soft-allows and logs when no run can be resolved", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-gate-empty-"));
    fs.mkdirSync(path.join(tmp, ".cursor/aaac/state/active-runs"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".cursor/aaac/runtime-registry.json"),
      JSON.stringify({ commands: {}, phases: {} }),
    );
    const { parsed, stderr } = runGate(
      tmp,
      { tool_name: "Read", tool_input: { path: "apps/foo/x.ts" } },
      { AAAC_RUN_ID: "" },
    );
    expect(parsed.permission).toBe("allow");
    expect(stderr).toMatch(/soft_allow_no_run/);
  });

  it("does not existence-heal an on-disk file outside the packet", () => {
    const { tmp, runId } = setupWorkspace();
    const secret = path.join(tmp, "apps/foo/secret.ts");
    fs.mkdirSync(path.dirname(secret), { recursive: true });
    fs.writeFileSync(secret, "export const secret = 1;\n");
    const { parsed } = runGate(tmp, {
      tool_name: "Read",
      tool_input: { path: "apps/foo/secret.ts" },
    });
    expect(parsed.permission).toBe("deny");
    expect(String(parsed.agent_message ?? "")).not.toMatch(/now in the packet/i);
    const pc = JSON.parse(
      fs.readFileSync(
        path.join(tmp, ".cursor/aaac/state/runs", runId, "artifacts/phase_context.json"),
        "utf8",
      ),
    );
    expect(pc.healed_paths ?? []).not.toContain("apps/foo/secret.ts");
    expect(pc.experience?.repo_memory?.focus_paths ?? []).not.toContain(
      "apps/foo/secret.ts",
    );
  });
});
