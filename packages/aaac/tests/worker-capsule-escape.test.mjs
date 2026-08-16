/**
 * Acceptance: a check worker in a grant capsule cannot read the real repo.
 * Cursor finders are impossible because the OS deny is path-based, not tool-based.
 */
import { describe, expect, it, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { materializeWorkerCapsule } from "../src/run-engine/worker-capsule.mjs";
import {
  resolveSandboxLauncher,
  sandboxSpawnArgv,
} from "../src/run-engine/worker-sandbox.mjs";

const temps = [];
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-escape-ws-"));
  temps.push(root);
  const granted = "apps/foo/repo-memory.ts";
  const hidden = "apps/foo/hidden-impl.ts";
  fs.mkdirSync(path.join(root, "apps/foo"), { recursive: true });
  fs.writeFileSync(path.join(root, granted), "export function getRepoGraph() {}\n");
  fs.writeFileSync(path.join(root, hidden), "export function secretImpl() {}\n");
  const { capsuleDir } = materializeWorkerCapsule({
    workspaceRoot: root,
    runId: "run_escape",
    phaseContext: { experience: { repo_memory: { focus_paths: [granted] } } },
    manifest: { verb: "check" },
    phase: "discover",
  });
  return { root, granted, hidden, capsuleDir };
}

const darwin = process.platform === "darwin";

describe.skipIf(!darwin)("malicious check-worker escape matrix", () => {
  it("cannot read unknown, directory, or hidden source via any node/fs/shell path", () => {
    const { root, granted, hidden, capsuleDir } = setup();
    const launcher = resolveSandboxLauncher({ capsuleDir, workspaceRoot: root });
    const hiddenAbs = path.join(root, hidden);
    const grantedAbs = path.join(capsuleDir, granted);
    const dirAbs = path.join(root, "apps/foo");

    const run = (js) => {
      const wrapped = sandboxSpawnArgv(launcher, process.execPath, ["-e", js]);
      return spawnSync(wrapped.cmd, wrapped.args, { encoding: "utf8", timeout: 8000 });
    };

    const hiddenRead = run(
      `const fs=require("fs");try{fs.readFileSync(${JSON.stringify(hiddenAbs)},"utf8");process.exit(0)}catch(e){process.stderr.write(e.code||e.message);process.exit(2)}`,
    );
    expect(hiddenRead.status).not.toBe(0);

    const dirList = run(
      `const fs=require("fs");try{fs.readdirSync(${JSON.stringify(dirAbs)});process.exit(0)}catch(e){process.exit(2)}`,
    );
    expect(dirList.status).not.toBe(0);

    const walk = run(
      `const fs=require("fs");const path=require("path");function w(d){for(const n of fs.readdirSync(d)){const p=path.join(d,n);if(fs.statSync(p).isDirectory())w(p)}}try{w(${JSON.stringify(root)});process.exit(0)}catch(e){process.exit(2)}`,
    );
    expect(walk.status).not.toBe(0);

    const grantedRead = run(
      `const fs=require("fs");process.stdout.write(fs.readFileSync(${JSON.stringify(grantedAbs)},"utf8"))`,
    );
    expect(grantedRead.status).toBe(0);
    expect(grantedRead.stdout).toMatch(/getRepoGraph/);

    const output = path.join(capsuleDir, ".aaac/OUTPUT.md");
    const writeOut = run(
      `const fs=require("fs");fs.mkdirSync(${JSON.stringify(path.dirname(output))},{recursive:true});fs.writeFileSync(${JSON.stringify(output)},"ok");`,
    );
    expect(writeOut.status).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toBe("ok");
  });
});
