/**
 * OS capability layer for check-swarm workers.
 * Fail closed: if isolation cannot be proven, do not spawn on the real repo.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

function posixReal(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Seatbelt `subpath` denies are ignored on current macOS; regex file-read* is enforced. */
export function escapeSeatbeltRegex(p) {
  return String(p)
    .replace(/\\/g, "/")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function siblingDenyRoots(workspaceRoot) {
  const root = posixReal(workspaceRoot);
  const out = [root, path.resolve(workspaceRoot)];
  const sibling = posixReal(path.join(root, "..", "repo-split"));
  if (sibling !== root) out.push(sibling);
  return [...new Set(out.filter(Boolean))];
}

export function buildMacosSeatbeltProfile({ capsuleDir, workspaceRoot, extraDeny = [] } = {}) {
  const deny = [...siblingDenyRoots(workspaceRoot), ...extraDeny];
  const denyRules = deny
    .map((p) => {
      const re = escapeSeatbeltRegex(p);
      return `(deny file-read* (regex #"^${re}(/|$)"))\n(deny file-write-data (regex #"^${re}(/|$)"))`;
    })
    .join("\n");
  return `(version 1)
(allow default)
${denyRules}
(allow network-outbound)
(allow network-inbound)
`;
}

const ELECTRON_BIN_RE =
  /(^|\/)(Electron|Agentic OS|Code - OSS|Cursor)(\.exe)?$/i;

export function isUsableProbeNodeBin(bin) {
  if (!bin || typeof bin !== "string") return false;
  const base = path.basename(bin);
  if (ELECTRON_BIN_RE.test(base) || ELECTRON_BIN_RE.test(bin)) return false;
  if (!/(^|\/)node(\.exe)?$/i.test(base)) return false;
  try {
    return fs.existsSync(bin);
  } catch {
    return false;
  }
}

/**
 * Probe must run `node -e`. Electron/Agentic OS execPath is not Node.
 */
export function resolveProbeNodeBin(preferred = process.execPath) {
  const envBin = String(process.env.AAAC_PROBE_NODE_BIN ?? "").trim();
  const candidates = [
    envBin,
    preferred,
    process.execPath,
    process.env.NODE_BINARY,
    process.env.npm_node_execpath,
  ].filter(Boolean);
  const which = spawnSync("which", ["node"], { encoding: "utf8" });
  if (which.status === 0) {
    candidates.push(String(which.stdout ?? "").trim());
  }
  for (const home of [process.env.HOME, os.homedir()].filter(Boolean)) {
    const nvmRoot = path.join(home, ".nvm/versions/node");
    try {
      const versions = fs.readdirSync(nvmRoot).sort().reverse();
      for (const v of versions) {
        candidates.push(path.join(nvmRoot, v, "bin/node"));
      }
    } catch {
      // nvm optional
    }
  }
  candidates.push("/usr/local/bin/node", "/opt/homebrew/bin/node");
  for (const cand of candidates) {
    if (isUsableProbeNodeBin(cand)) return cand;
  }
  throw new Error(
    "No real node binary for the capsule sandbox probe — will not spawn on the real repo",
  );
}

export function resolveSandboxLauncher({
  capsuleDir,
  workspaceRoot,
  platform = process.platform,
} = {}) {
  if (platform === "darwin") {
    const profile = buildMacosSeatbeltProfile({ capsuleDir, workspaceRoot });
    return {
      kind: "sandbox-exec",
      cmd: "sandbox-exec",
      prefixArgs: ["-p", profile],
      profile,
    };
  }
  if (platform === "linux") {
    const bwrap = process.env.AAAC_BWRAP_BIN || "bwrap";
    return {
      kind: "bwrap",
      cmd: bwrap,
      prefixArgs: [
        "--unshare-pid",
        "--die-with-parent",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
        "--ro-bind",
        "/usr",
        "/usr",
        "--ro-bind-try",
        "/bin",
        "/bin",
        "--ro-bind-try",
        "/lib",
        "/lib",
        "--ro-bind-try",
        "/lib64",
        "/lib64",
        "--ro-bind-try",
        "/opt",
        "/opt",
        "--bind",
        path.resolve(capsuleDir),
        path.resolve(capsuleDir),
        "--chdir",
        path.resolve(capsuleDir),
      ],
    };
  }
  return null;
}

export function probeSandboxIsolation({
  launcher,
  workspaceRoot,
  capsuleDir,
  nodeBin = null,
} = {}) {
  if (!launcher?.cmd) {
    return { ok: false, reason: "no_launcher" };
  }
  const probeNode = resolveProbeNodeBin(nodeBin ?? process.execPath);
  const secretRel = `.aaac-sandbox-probe-${Date.now()}.txt`;
  const secret = path.join(workspaceRoot, secretRel);
  const granted = path.join(capsuleDir, ".aaac", "probe-ok.txt");
  fs.mkdirSync(path.dirname(granted), { recursive: true });
  fs.writeFileSync(secret, "SECRET_WORKSPACE");
  fs.writeFileSync(granted, "GRANTED_OK");
  try {
    const deny = spawnSync(
      launcher.cmd,
      [
        ...launcher.prefixArgs,
        probeNode,
        "-e",
        `const fs=require("fs");try{process.stdout.write(fs.readFileSync(${JSON.stringify(secret)},"utf8"))}catch(e){process.stderr.write(String(e.message));process.exit(2)}`,
      ],
      { encoding: "utf8", timeout: 8000 },
    );
    const allow = spawnSync(
      launcher.cmd,
      [
        ...launcher.prefixArgs,
        probeNode,
        "-e",
        `const fs=require("fs");process.stdout.write(fs.readFileSync(${JSON.stringify(granted)},"utf8"))`,
      ],
      { encoding: "utf8", timeout: 8000 },
    );
    const deniedWorkspace =
      deny.status !== 0 || !String(deny.stdout ?? "").includes("SECRET_WORKSPACE");
    const allowedCapsule =
      allow.status === 0 && String(allow.stdout ?? "").includes("GRANTED_OK");
    return {
      ok: deniedWorkspace && allowedCapsule,
      deniedWorkspace,
      allowedCapsule,
      denyStatus: deny.status,
      allowStatus: allow.status,
      denyStderr: String(deny.stderr ?? "").slice(0, 500),
      allowStderr: String(allow.stderr ?? "").slice(0, 500),
      reason:
        deniedWorkspace && allowedCapsule
          ? "ok"
          : !deniedWorkspace
            ? "workspace_readable"
            : "capsule_unreadable",
    };
  } finally {
    try {
      fs.unlinkSync(secret);
    } catch {
      // ignore
    }
  }
}

export function assertWorkerSandbox({ capsuleDir, workspaceRoot } = {}) {
  if (String(process.env.AAAC_SANDBOX_SKIP_PROBE ?? "") === "1") {
    const launcher = resolveSandboxLauncher({ capsuleDir, workspaceRoot });
    if (!launcher) {
      throw new Error("Worker capsule sandbox unavailable on this platform");
    }
    return { launcher, probe: { ok: true, reason: "skipped" } };
  }
  const launcher = resolveSandboxLauncher({ capsuleDir, workspaceRoot });
  if (!launcher) {
    throw new Error("Worker capsule sandbox unavailable on this platform — fail closed");
  }
  const which = spawnSync("which", [path.basename(launcher.cmd)], {
    encoding: "utf8",
  });
  const cmdExists =
    launcher.cmd.includes(path.sep)
      ? fs.existsSync(launcher.cmd)
      : which.status === 0 || fs.existsSync(launcher.cmd);
  if (!cmdExists && launcher.kind === "bwrap") {
    throw new Error("bwrap not found — fail closed (will not spawn on the real repo)");
  }
  if (!cmdExists && launcher.kind === "sandbox-exec") {
    throw new Error("sandbox-exec not found — fail closed");
  }
  const probe = probeSandboxIsolation({ launcher, workspaceRoot, capsuleDir });
  if (!probe.ok) {
    throw new Error(
      `Worker capsule sandbox probe failed (${probe.reason}) — will not spawn on the real repo`,
    );
  }
  return { launcher, probe };
}

export function sandboxSpawnArgv(launcher, bin, args) {
  return {
    cmd: launcher.cmd,
    args: [...launcher.prefixArgs, bin, ...args],
  };
}

export function tmpCapsuleHome() {
  return path.join(os.tmpdir(), "aaac-capsule-homes");
}
