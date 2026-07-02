/**
 * SSOT for /remediate-app project wiring — reads `.cursor/aaac/project.config.json`.
 */
import path from "path";
import { REPO_ROOT, readJson } from "../../run-engine/lib.mjs";

const CONFIG_PATH = path.join(REPO_ROOT, ".cursor/aaac/project.config.json");

const DEFAULT_LAYERS = [
  {
    id: "typecheck",
    command: "npm",
    args: ["run", "typecheck"],
    cwd: ".",
    optional: true,
  },
  {
    id: "vitest",
    command: "npm",
    args: ["test"],
    cwd: ".",
    optional: true,
  },
  {
    id: "build",
    command: "npm",
    args: ["run", "build"],
    cwd: ".",
    optional: true,
  },
];

export function loadRemediationConfig() {
  const project = readJson(CONFIG_PATH, {});
  const remediation = project.remediation ?? {};
  const verify = remediation.verify ?? {};

  const fallowCwd = remediation.fallow_cwd ?? remediation.scan_root ?? ".";
  const scanRoot = remediation.scan_root ?? fallowCwd;

  return {
    fallow_cwd: fallowCwd,
    scan_root: scanRoot,
    verify: {
      layers: Array.isArray(verify.layers) && verify.layers.length > 0 ? verify.layers : DEFAULT_LAYERS,
      playwright: {
        enabled: false,
        config: null,
        cwd: ".",
        ...(verify.playwright ?? {}),
      },
      dev_server: {
        url: "http://localhost:3000",
        launch_hint:
          "Start your dev server before debt sweep / Playwright gates (see project.config.json remediation.verify.dev_server).",
        ...(verify.dev_server ?? {}),
      },
      strict_modes: verify.strict_modes ?? ["iteration", "strict", "debt"],
    },
  };
}

export function resolveLayerKeys(config = loadRemediationConfig()) {
  const keys = config.verify.layers.map((layer) => layer.id);
  if (config.verify.playwright?.enabled) {
    keys.push("playwright");
  }
  return keys;
}
