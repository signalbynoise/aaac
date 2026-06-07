import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, RUN_ENGINE_DIR } from "./fixtures/paths.mjs";

const VERIFY_SCRIPT = path.join(RUN_ENGINE_DIR, "verify-website-build.mjs");

describe("verify-website-build config", () => {
  it("skips when verify.enabled is false", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-verify-off-"));
    const cursorAaac = path.join(tmp, ".cursor", "aaac");
    fs.mkdirSync(cursorAaac, { recursive: true });
    fs.writeFileSync(
      path.join(cursorAaac, "project.config.json"),
      JSON.stringify({ verify: { enabled: false } }, null, 2),
    );

    const result = spawnSync("node", [VERIFY_SCRIPT], {
      cwd: tmp,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    expect(json.skipped).toBe(true);
    expect(json.verify_config).toBe("disabled");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("runs when verify.enabled is true in Lüdecker repo", () => {
    const result = spawnSync("node", [VERIFY_SCRIPT, "--skip-build"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    expect(json.verify_config).toBe("enabled");
  });
});
