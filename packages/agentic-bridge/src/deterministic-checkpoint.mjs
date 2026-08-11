/**
 * Deterministic swarm checkpoint — merge {phase}_agent_N.md into required
 * phase artifacts without an LLM. Falls back to the caller for LLM synthesis
 * when validation fails.
 */
import fs from "fs";
import path from "path";
import { createLogger } from "./logger.mjs";

const log = createLogger("agentic-bridge:deterministic-checkpoint");

const MAX_EVIDENCE = 10;
const MAX_ANSWER_CHARS = 1800;

function runsRootFor(workspaceRoot) {
  return path.join(workspaceRoot, ".cursor", "aaac", "state", "runs");
}

/**
 * @param {string} workspaceRoot
 * @param {string} runId
 * @param {string} phase
 * @param {number} swarmAgentCount
 * @returns {string[]}
 */
export function readSwarmAgentBodies(workspaceRoot, runId, phase, swarmAgentCount) {
  const artifactsDir = path.join(runsRootFor(workspaceRoot), runId, "artifacts");
  const bodies = [];
  const n = Math.max(1, Number(swarmAgentCount) || 1);
  for (let i = 1; i <= n; i += 1) {
    const file = path.join(artifactsDir, `${phase}_agent_${i}.md`);
    if (!fs.existsSync(file)) continue;
    try {
      const text = fs.readFileSync(file, "utf8").trim();
      if (text) bodies.push({ index: i, text, rel: `artifacts/${phase}_agent_${i}.md` });
    } catch (err) {
      log.warn("read-agent", "Failed to read swarm agent artifact", {
        file,
        error: String(err?.message ?? err),
      });
    }
  }
  return bodies;
}

function extractSection(text, headingPattern) {
  const re = new RegExp(
    `(?:^|\\n)##?\\s*(?:${headingPattern})[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  const m = text.match(re);
  return m?.[1] != null ? String(m[1]).trim() : "";
}

function extractBulletPaths(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(/^\s*[-*]\s+`?([A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+)`?/);
    if (m) out.push(m[1]);
    const bare = line.match(/^\s*[-*]\s+([A-Za-z0-9_./+-]+\.[A-Za-z0-9]+)\s*$/);
    if (bare) out.push(bare[1]);
  }
  return [...new Set(out)];
}

function extractEvidenceLines(bodies) {
  const lines = [];
  for (const b of bodies) {
    const evidence = extractSection(b.text, "Evidence|Findings");
    for (const line of evidence.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|") && !trimmed.startsWith("-") && !trimmed.startsWith("*")) {
        continue;
      }
      if (trimmed.startsWith("|") && /Claim|Evidence|---/.test(trimmed)) continue;
      if (trimmed.startsWith("|")) {
        const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          lines.push(`"${cells[0]} — ${cells[1]}"`.slice(0, 200));
        }
        continue;
      }
      const item = trimmed.replace(/^[-*]\s+/, "").replace(/^"+|"+$/g, "");
      if (item) lines.push(`"${item.slice(0, 180)}"`);
      if (lines.length >= MAX_EVIDENCE) break;
    }
    if (lines.length >= MAX_EVIDENCE) break;
  }
  if (lines.length === 0) {
    for (const b of bodies) {
      lines.push(`"swarm ${b.rel}"`);
      if (lines.length >= Math.min(3, MAX_EVIDENCE)) break;
    }
  }
  return lines.slice(0, MAX_EVIDENCE);
}

function extractAnswer(bodies, manifest) {
  const bits = [];
  for (const b of bodies) {
    const findings = extractSection(b.text, "Findings|Summary|Inventory");
    if (findings) {
      const first = findings
        .split("\n")
        .map((l) => l.replace(/^[-*]\s+\*\*[^*]+\*\*:?\s*/, "").replace(/^[-*]\s+/, "").trim())
        .filter((l) => l.length > 40)
        .slice(0, 2);
      bits.push(...first);
    }
  }
  const domain = manifest?.domain ?? manifest?.object ?? "domain";
  const intent = String(manifest?.intent ?? "").slice(0, 120);
  const header = `Deterministic merge of ${bodies.length} ${manifest?.phase ?? "phase"} swarm agents for ${domain}${intent ? ` (${intent})` : ""}.`;
  const body = bits.length ? bits.join(" ") : bodies.map((b) => b.text.slice(0, 280)).join(" ");
  return `${header} ${body}`.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_CHARS);
}

function yamlList(items, indent = "  ") {
  if (!items.length) return `${indent}[]`;
  return items.map((i) => `${indent}- ${i}`).join("\n");
}

function buildDiscoverBrief(bodies, manifest) {
  const answer = extractAnswer(bodies, manifest);
  const evidence = extractEvidenceLines(bodies);
  const confirmed = [];
  const stale = [];
  const neu = [];
  for (const b of bodies) {
    confirmed.push(...extractBulletPaths(extractSection(b.text, "Confirmed.*")));
    stale.push(...extractBulletPaths(extractSection(b.text, "Stale.*")));
    neu.push(...extractBulletPaths(extractSection(b.text, "New findings.*|Gaps")));
  }
  const uniq = (arr) => [...new Set(arr)].slice(0, 40);
  const pathList = (arr) =>
    uniq(arr).length ? uniq(arr).map((p) => `  - ${p}`).join("\n") : "  []";
  return [
    `answer: >-`,
    `  ${answer.replace(/\n/g, " ")}`,
    ``,
    `evidence:`,
    yamlList(evidence.length ? evidence : ['"see swarm agent artifacts"']),
    ``,
    `confirmed:`,
    pathList(confirmed),
    ``,
    `stale:`,
    pathList(stale),
    ``,
    `new_findings:`,
    pathList(neu),
    ``,
    `confidence: 0.7`,
    `source: deterministic_checkpoint`,
    ``,
  ].join("\n");
}

function buildDiscoveryBriefMd(bodies, manifest) {
  const lines = [
    `# Discovery brief (deterministic merge)`,
    ``,
    `Command: ${manifest?.command ?? "unknown"}`,
    `Domain: ${manifest?.domain ?? manifest?.object ?? ""}`,
    `Intent: ${manifest?.intent ?? ""}`,
    ``,
  ];
  for (const b of bodies) {
    lines.push(`## Agent ${b.index}`);
    lines.push(``);
    lines.push(b.text.slice(0, 6000));
    lines.push(``);
  }
  return lines.join("\n");
}

function buildPlanYaml(bodies, manifest) {
  const reqs = bodies.map((b, i) => ({
    requirement: `Incorporate swarm plan agent ${b.index} findings`,
    satisfies_with: [b.rel],
    status: "satisfied",
  }));
  if (!reqs.length) {
    reqs.push({
      requirement: "No plan agent artifacts; placeholder plan",
      satisfies_with: [],
      status: "satisfied",
    });
  }
  const lines = [
    `# Plan — deterministic merge`,
    `verb: ${manifest?.verb ?? "review"}`,
    `object: ${manifest?.object ?? "system"}`,
    `domain: ${manifest?.domain ?? ""}`,
    `intent: ${JSON.stringify(String(manifest?.intent ?? "").slice(0, 200))}`,
    ``,
    `requirement_map:`,
  ];
  for (const r of reqs) {
    lines.push(`  - requirement: ${JSON.stringify(r.requirement)}`);
    lines.push(`    satisfies_with: [${r.satisfies_with.map((s) => JSON.stringify(s)).join(", ")}]`);
    lines.push(`    status: ${r.status}`);
  }
  lines.push(``);
  lines.push(`tests_to_add: []`);
  lines.push(`source: deterministic_checkpoint`);
  lines.push(``);
  lines.push(`# Agent excerpts`);
  for (const b of bodies) {
    lines.push(`# --- ${b.rel} ---`);
    for (const line of b.text.split("\n").slice(0, 80)) {
      lines.push(`# ${line}`);
    }
  }
  lines.push(``);
  return lines.join("\n");
}

function buildReportMd(bodies, manifest) {
  const lines = [
    `# Report (deterministic merge)`,
    ``,
    `Run command: ${manifest?.command ?? ""}`,
    ``,
  ];
  for (const b of bodies) {
    lines.push(`## Report agent ${b.index}`);
    lines.push(``);
    lines.push(b.text.slice(0, 8000));
    lines.push(``);
  }
  if (!bodies.length) {
    lines.push(`No report agent artifacts were available for merge.`);
    lines.push(``);
  }
  return lines.join("\n");
}

function writeArtifact(runArtifactsDir, rel, content) {
  const abs = path.join(runArtifactsDir, path.basename(rel));
  // rel is artifacts/foo — write under run/artifacts
  const target = path.join(runArtifactsDir, rel.replace(/^artifacts\//, ""));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

/**
 * Attempt deterministic synthesis of missing phase artifacts.
 * @returns {{ ok: boolean, written: string[], reason?: string }}
 */
export function synthesizePhaseCheckpointDeterministic({
  workspaceRoot,
  runId,
  phase,
  manifest,
  swarmAgentCount,
  missing = [],
}) {
  const runsRoot = runsRootFor(workspaceRoot);
  const artifactsDir = path.join(runsRoot, runId, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  const bodies = readSwarmAgentBodies(workspaceRoot, runId, phase, swarmAgentCount);
  if (!bodies.length && missing.length) {
    return {
      ok: false,
      written: [],
      reason: "no swarm agent artifacts to merge",
    };
  }

  const need = new Set(
    (missing.length ? missing : [
      phase === "discover" ? "artifacts/discover_brief.yaml" : null,
      phase === "discover" ? "artifacts/discovery-brief.md" : null,
      phase === "plan" ? "artifacts/plan.yaml" : null,
      phase === "report" ? "artifacts/report.md" : null,
    ].filter(Boolean)).map((r) => String(r).replace(/\\/g, "/")),
  );

  const written = [];
  try {
    if (phase === "discover") {
      if (need.has("artifacts/discover_brief.yaml")) {
        writeArtifact(artifactsDir, "artifacts/discover_brief.yaml", buildDiscoverBrief(bodies, { ...manifest, phase }));
        written.push("artifacts/discover_brief.yaml");
      }
      if (need.has("artifacts/discovery-brief.md")) {
        writeArtifact(artifactsDir, "artifacts/discovery-brief.md", buildDiscoveryBriefMd(bodies, manifest));
        written.push("artifacts/discovery-brief.md");
      }
    } else if (phase === "plan") {
      if (need.has("artifacts/plan.yaml")) {
        writeArtifact(artifactsDir, "artifacts/plan.yaml", buildPlanYaml(bodies, manifest));
        written.push("artifacts/plan.yaml");
      }
    } else if (phase === "report") {
      if (need.has("artifacts/report.md")) {
        writeArtifact(artifactsDir, "artifacts/report.md", buildReportMd(bodies, manifest));
        written.push("artifacts/report.md");
      }
    } else {
      // Generic: write a markdown merge for any other missing *.md / *.yaml basename
      for (const rel of need) {
        const base = path.basename(rel);
        if (base.endsWith(".md")) {
          writeArtifact(artifactsDir, rel, buildReportMd(bodies, { ...manifest, phase }));
          written.push(rel);
        } else if (base.endsWith(".yaml") || base.endsWith(".yml")) {
          writeArtifact(artifactsDir, rel, buildPlanYaml(bodies, { ...manifest, phase }));
          written.push(rel);
        }
      }
    }
  } catch (err) {
    log.error("synthesize", "Deterministic checkpoint write failed", {
      runId,
      phase,
      error: String(err?.message ?? err),
    });
    return { ok: false, written, reason: String(err?.message ?? err) };
  }

  // Light validation: required files exist and discover has answer:
  for (const rel of need) {
    const abs = path.join(runsRoot, runId, rel);
    if (!fs.existsSync(abs)) {
      return { ok: false, written, reason: `missing after write: ${rel}` };
    }
    if (rel.endsWith("discover_brief.yaml")) {
      const content = fs.readFileSync(abs, "utf8");
      if (!/^answer:/m.test(content)) {
        return { ok: false, written, reason: "discover_brief.yaml missing answer:" };
      }
    }
    if (rel.endsWith("plan.yaml") && manifest?.verb && !["check", "review", "explore"].includes(String(manifest.verb))) {
      const content = fs.readFileSync(abs, "utf8");
      if (!/tests_to_add\s*:/m.test(content)) {
        return { ok: false, written, reason: "plan.yaml missing tests_to_add" };
      }
    }
  }

  log.info("synthesize", "Deterministic checkpoint wrote artifacts", {
    runId,
    phase,
    written,
    agents: bodies.length,
  });
  return { ok: true, written };
}
