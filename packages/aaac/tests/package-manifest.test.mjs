import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG_JSON = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));

describe("package.json publish manifest", () => {
  it("bin paths omit ./ prefix (npm publish auto-corrects and warns otherwise)", () => {
    expect(PKG_JSON.bin).toEqual({ aaac: "src/cli.mjs" });
    for (const target of Object.values(PKG_JSON.bin)) {
      expect(target.startsWith("./")).toBe(false);
      expect(fs.existsSync(path.join(PKG_DIR, target))).toBe(true);
    }
  });

  it("cli entry has shebang for npm bin linking", () => {
    const cli = fs.readFileSync(path.join(PKG_DIR, "src/cli.mjs"), "utf8");
    expect(cli.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("repository.url uses git+https form expected by npm pkg fix", () => {
    expect(PKG_JSON.repository.url).toBe("git+https://github.com/eriklydecker/ludecker.git");
  });

  it("npm pack does not warn about bin entry", () => {
    const result = spawnSync("npm", ["pack", "--dry-run"], {
      cwd: PKG_DIR,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/bin\[aaac\].*invalid/i);
    expect(result.stderr).not.toMatch(/auto-corrected/i);
  });

  it("published template installs an executable postToolUse progress hook", () => {
    const hooks = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, "templates/cursor/hooks.json"), "utf8"),
    );
    expect(hooks.hooks.postToolUse).toContainEqual(
      expect.objectContaining({
        command: ".cursor/hooks/aaac-post-tool.sh",
        failClosed: false,
      }),
    );

    const hookPath = path.join(PKG_DIR, "templates/cursor/hooks/aaac-post-tool.sh");
    const hook = fs.readFileSync(hookPath, "utf8");
    expect(hook.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(hook).toContain("record-subagent-progress.mjs");
    expect(fs.statSync(hookPath).mode & 0o111).not.toBe(0);
  });
});
