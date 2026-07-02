import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./fixtures/paths.mjs";

const REMEDIATION_CONFIG = path.join(
  REPO_ROOT,
  ".cursor/aaac/scripts/remediation/lib/remediation-config.mjs",
);

describe("remediation-config", () => {
  it("loads default layers when remediation section is absent", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-remediation-config-"));
    const cursorAaac = path.join(tmp, ".cursor", "aaac");
    fs.mkdirSync(path.join(cursorAaac, "scripts", "run-engine"), { recursive: true });
    fs.mkdirSync(path.join(cursorAaac, "scripts", "remediation", "lib"), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, ".cursor/aaac/scripts/run-engine/lib.mjs"),
      path.join(cursorAaac, "scripts/run-engine/lib.mjs"),
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, ".cursor/aaac/scripts/remediation/lib/remediation-config.mjs"),
      path.join(cursorAaac, "scripts/remediation/lib/remediation-config.mjs"),
    );
    fs.writeFileSync(path.join(cursorAaac, "project.config.json"), JSON.stringify({ verify: { enabled: false } }));

    const configPath = path.join(cursorAaac, "scripts/remediation/lib/remediation-config.mjs");
    const script = `
      import { loadRemediationConfig, resolveLayerKeys } from ${JSON.stringify(configPath)};
      const config = loadRemediationConfig();
      console.log(JSON.stringify({ keys: resolveLayerKeys(config), layerCount: config.verify.layers.length }));
    `;
    const result = spawnSync("node", ["--input-type=module", "-e", script], {
      cwd: tmp,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    expect(json.layerCount).toBe(3);
    expect(json.keys).toEqual(["typecheck", "vitest", "build"]);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("Lüdecker project.config includes remediation verify layers", async () => {
    const script = `
      import { loadRemediationConfig, resolveLayerKeys } from ${JSON.stringify(REMEDIATION_CONFIG)};
      const config = loadRemediationConfig();
      console.log(JSON.stringify({ keys: resolveLayerKeys(config), url: config.verify.dev_server.url }));
    `;
    const result = spawnSync("node", ["--input-type=module", "-e", script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    expect(json.keys).toContain("typecheck");
    expect(json.keys).toContain("playwright");
    expect(json.url).toMatch(/localhost/);
  });
});

describe("remediate-app graph wiring", () => {
  it("graph.yaml registers remediate-app workflow and orchestrator", () => {
    const graph = fs.readFileSync(path.join(REPO_ROOT, ".cursor/aaac/graph.yaml"), "utf8");
    expect(graph).toMatch(/remediate-app:/);
    expect(graph).toContain("campaign_init, scan, check_swarm, plan_waves, execute, debt_sweep, satisfaction_gate, report");
    expect(graph).toContain("skills/shared/remediation/orchestrator");
  });

  it("npm template ships remediate-app command and scripts", () => {
    const command = path.join(REPO_ROOT, "packages/aaac/templates/cursor/commands/remediate-app.md");
    const initScript = path.join(
      REPO_ROOT,
      "packages/aaac/templates/cursor/aaac/scripts/remediation/init-campaign.mjs",
    );
    expect(fs.existsSync(command)).toBe(true);
    expect(fs.existsSync(initScript)).toBe(true);
  });
});

describe("init-campaign", () => {
  it("creates campaign state for a remediate-app run", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-init-campaign-"));
    const cursorAaac = path.join(tmp, ".cursor", "aaac");
    const runId = "run_test_remediate_init";
    const runDir = path.join(cursorAaac, "state", "runs", runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(cursorAaac, "scripts", "remediation"), { recursive: true });
    fs.mkdirSync(path.join(cursorAaac, "scripts", "run-engine"), { recursive: true });

    fs.copyFileSync(
      path.join(REPO_ROOT, "packages/aaac/templates/cursor/aaac/scripts/run-engine/lib.mjs"),
      path.join(cursorAaac, "scripts/run-engine/lib.mjs"),
    );
    for (const file of fs.readdirSync(
      path.join(REPO_ROOT, "packages/aaac/templates/cursor/aaac/scripts/remediation"),
    )) {
      const src = path.join(REPO_ROOT, "packages/aaac/templates/cursor/aaac/scripts/remediation", file);
      const dest = path.join(cursorAaac, "scripts/remediation", file);
      if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
    }

    fs.writeFileSync(
      path.join(cursorAaac, "project.config.json"),
      JSON.stringify({ remediation: { fallow_cwd: "." } }, null, 2),
    );
    fs.writeFileSync(
      path.join(runDir, "run.json"),
      JSON.stringify(
        {
          run_id: runId,
          command: "remediate-app",
          verb: "remediate",
          intent: "max_iterations=2; satisfaction_threshold=85",
          conversation_id: "test-conv",
        },
        null,
        2,
      ),
    );

    const result = spawnSync(
      "node",
      [path.join(cursorAaac, "scripts/remediation/init-campaign.mjs"), "--run-id", runId, "--scope", "whole-repo"],
      { cwd: tmp, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    expect(json.ok).toBe(true);
    expect(json.campaign_id).toMatch(/^campaign_/);
    expect(fs.existsSync(path.join(json.campaign_dir, "campaign.json"))).toBe(true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
