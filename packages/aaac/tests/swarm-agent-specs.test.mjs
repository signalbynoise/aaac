import { afterAll, describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  loadGraphSwarmConfig,
  resolveAgentSpecById,
  resolveAgentSpecsForPhase,
  resolveSwarmSkillId,
  synthesizeFallbackAgentIds,
  loadPhasesConfig,
} from "../src/run-engine/swarm-agent-specs.mjs";
import {
  extractRoleInitialSummary,
  validateInitialSummary,
} from "../src/run-engine/agent-progress-contract.mjs";
import { validateStageSummaryEntry } from "../src/run-engine/write-stage-summary.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const AAAC_ROOT = path.join(REPO_ROOT, ".cursor/aaac");
const CURSOR_ROOT = path.join(REPO_ROOT, ".cursor");
const TEMPLATE_CURSOR_ROOT = path.join(REPO_ROOT, "packages/aaac/templates/cursor");
const TEMPLATE_GRAPH_PATH = path.join(TEMPLATE_CURSOR_ROOT, "aaac/graph.project.yaml");
const TEMPLATE_AAAC_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-template-graph-"));
const PHASE_ROSTERS = [
  {
    phase: "investigate_lite",
    skill: "investigation-lite",
    ids: [
      "investigate-lite-exists",
      "investigate-lite-dependencies",
      "investigate-lite-constraints",
    ],
  },
  {
    phase: "impact_analysis",
    skill: "impact-analysis",
    ids: ["impact-analysis", "dependency-analysis"],
  },
  {
    phase: "dependency_graph",
    skill: "dependency-graph",
    ids: ["dependency-analysis", "boundary-review"],
  },
  {
    phase: "fitness_functions",
    skill: "fitness-functions",
    ids: ["boundary-review", "doc-conformance", "fallow-check-changed"],
  },
  {
    phase: "root_cause",
    skill: "root-cause",
    ids: ["root-cause-analyst", "fix-hypothesis-validate"],
  },
  {
    phase: "validate",
    skill: "validation",
    ids: [
      "gate-validate-confidence",
      "gate-validate-complexity",
      "gate-validate-requirements",
    ],
  },
  {
    phase: "rollback",
    skill: "rollback",
    ids: ["gate-rollback-feasibility", "gate-rollback-verification"],
  },
  {
    phase: "report",
    skill: "reporting",
    ids: ["report-completeness-review", "report-factual-review"],
  },
];

fs.mkdirSync(path.join(TEMPLATE_AAAC_ROOT, "lifecycle"), { recursive: true });
fs.copyFileSync(TEMPLATE_GRAPH_PATH, path.join(TEMPLATE_AAAC_ROOT, "graph.yaml"));
fs.copyFileSync(
  path.join(AAAC_ROOT, "lifecycle/phases.json"),
  path.join(TEMPLATE_AAAC_ROOT, "lifecycle/phases.json"),
);

afterAll(() => {
  fs.rmSync(TEMPLATE_AAAC_ROOT, { recursive: true, force: true });
});

function loadTemplateGraphSwarmConfig() {
  return loadGraphSwarmConfig(TEMPLATE_AAAC_ROOT);
}

function graphRoleCases(label, cursorRoot, graphConfig) {
  return Object.entries(graphConfig.agentPaths).map(([id, relPath]) => ({
    label,
    id,
    relPath,
    content: fs.readFileSync(path.join(cursorRoot, relPath), "utf8"),
  }));
}

const GRAPH_ROLE_CASES = [
  ...graphRoleCases("live", CURSOR_ROOT, loadGraphSwarmConfig(AAAC_ROOT)),
  ...graphRoleCases(
    "template",
    TEMPLATE_CURSOR_ROOT,
    loadTemplateGraphSwarmConfig(),
  ),
];

const GRAPH_CONFIGS = [
  {
    label: "live",
    aaacRoot: AAAC_ROOT,
    cursorRoot: CURSOR_ROOT,
    config: loadGraphSwarmConfig(AAAC_ROOT),
  },
  {
    label: "template",
    aaacRoot: TEMPLATE_AAAC_ROOT,
    cursorRoot: TEMPLATE_CURSOR_ROOT,
    config: loadTemplateGraphSwarmConfig(),
  },
];

describe("swarm-agent-specs", () => {
  it("loads skill agents from graph.yaml", () => {
    const { skillAgents } = loadGraphSwarmConfig(AAAC_ROOT);
    expect(skillAgents.check).toEqual([
      "discovery-inventory",
      "discovery-ssot",
      "check-capability-trace",
    ]);
  });

  it("resolves check discover specs from graph", () => {
    const phasesConfig = loadPhasesConfig(AAAC_ROOT);
    const skillId = resolveSwarmSkillId(
      "discover",
      { verb: "check", command: "check-architecture" },
      phasesConfig,
    );
    expect(skillId).toBe("check");

    const specs = resolveAgentSpecsForPhase({
      aaacRoot: AAAC_ROOT,
      phase: "discover",
      manifest: { verb: "check", command: "check-architecture" },
      count: 3,
    });
    expect(specs.map((s) => s.id)).toEqual([
      "discovery-inventory",
      "discovery-ssot",
      "check-capability-trace",
    ]);
    expect(specs[0]?.cursorPath).toBe(".cursor/agents/discovery-inventory.md");
  });

  it("resolves mutating discover specs from discovery skill", () => {
    const specs = resolveAgentSpecsForPhase({
      aaacRoot: AAAC_ROOT,
      phase: "discover",
      manifest: { verb: "update", command: "update-module" },
      count: 4,
    });
    expect(specs.length).toBeGreaterThanOrEqual(3);
    expect(specs[0]?.id).toBe("discovery-inventory");
  });

  it("synthesizes skill-bound slots when graph skill has no agents", () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-empty-roster-"));
    try {
      fs.mkdirSync(path.join(emptyRoot, "lifecycle"), { recursive: true });
      fs.writeFileSync(
        path.join(emptyRoot, "lifecycle/phases.json"),
        JSON.stringify({
          phases: { validate: { skill: "validation", gate: true } },
        }),
      );
      fs.writeFileSync(
        path.join(emptyRoot, "graph.yaml"),
        [
          "skills:",
          "  validation:",
          "    path: skills/shared/validation",
          "agents:",
          "  discovery-inventory:",
          "    path: agents/discovery-inventory.md",
          "",
        ].join("\n"),
      );

      expect(synthesizeFallbackAgentIds("validate", "validation", 3)).toEqual([
        "validation-slot-1",
        "validation-slot-2",
        "validation-slot-3",
      ]);

      const specs = resolveAgentSpecsForPhase({
        aaacRoot: emptyRoot,
        phase: "validate",
        manifest: { verb: "check", command: "check-architecture" },
        count: 3,
      });
      expect(specs).toHaveLength(3);
      expect(specs.every((spec) => spec.synthetic === true)).toBe(true);
      expect(specs.map((spec) => spec.id)).toEqual([
        "validation-slot-1",
        "validation-slot-2",
        "validation-slot-3",
      ]);
      expect(specs[0]?.relPath).toBe("skills/shared/validation/SKILL.md");
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("resolves the execute code-author roster through the graph", () => {
    const phaseSpecs = resolveAgentSpecsForPhase({
      aaacRoot: AAAC_ROOT,
      phase: "execute",
      manifest: { verb: "update", command: "update-module" },
      count: 1,
    });
    expect(phaseSpecs).toEqual([
      {
        id: "code-author",
        path: ".cursor/agents/code-author.md",
        relPath: "agents/code-author.md",
        cursorPath: ".cursor/agents/code-author.md",
      },
    ]);

    const spec = resolveAgentSpecById({
      aaacRoot: AAAC_ROOT,
      id: "code-author",
    });
    expect(spec).toEqual({
      id: "code-author",
      path: ".cursor/agents/code-author.md",
      relPath: "agents/code-author.md",
      cursorPath: ".cursor/agents/code-author.md",
    });

    const content = fs.readFileSync(path.join(REPO_ROOT, spec.path), "utf8");
    expect(extractRoleInitialSummary(content)).toBeTruthy();
  });
});

describe("phase roster resolution", () => {
  it.each(GRAPH_CONFIGS)(
    "defines exact $label phase roster IDs and counts",
    ({ config }) => {
      for (const { skill, ids } of PHASE_ROSTERS) {
        expect(config.skillAgents[skill], skill).toEqual(ids);
        expect(config.skillAgents[skill], `${skill} count`).toHaveLength(ids.length);
      }
    },
  );

  it.each(GRAPH_CONFIGS)(
    "resolves required $label roles at target counts and preserves wave identity",
    ({ aaacRoot }) => {
      for (const { phase, ids } of PHASE_ROSTERS) {
        const manifest = { verb: "fix", command: "fix-architecture" };
        const targetSpecs = resolveAgentSpecsForPhase({
          aaacRoot,
          phase,
          manifest,
          count: ids.length,
        });
        expect(targetSpecs.map(({ id }) => id), phase).toEqual(ids);

        const waveSpecs = resolveAgentSpecsForPhase({
          aaacRoot,
          phase,
          manifest,
          count: ids.length + 1,
        });
        expect(waveSpecs.map(({ id }) => id), `${phase} wave`).toEqual([
          ...ids,
          `${ids[0]}-wave-${ids.length}`,
        ]);
        expect(waveSpecs.at(-1)?.relPath).toBe(`agents/${ids[0]}.md`);
      }
    },
  );

  it.each(GRAPH_CONFIGS)(
    "validates every $label phase roster spec Role and provenance",
    ({ cursorRoot, config }) => {
      for (const { skill, ids } of PHASE_ROSTERS) {
        for (const id of ids) {
          const relPath = config.agentPaths[id];
          const fullPath = path.join(cursorRoot, relPath);
          expect(fs.existsSync(fullPath), `${skill}:${id}`).toBe(true);
          const summary = extractRoleInitialSummary(fs.readFileSync(fullPath, "utf8"));
          const source = `agent-spec:.cursor/${relPath}#Role`;
          expect(validateInitialSummary(summary), `${id} initial`).toBe(summary);
          expect(validateStageSummaryEntry({
            layman: summary,
            source_artifacts: [source],
            metrics: {},
          }), `${id} stage`).toEqual({ ok: true });
        }
      }
    },
  );
});

describe("swarm-agent-specs", () => {
  it("wave_fill_preserves_unique_agent_spec_ids", () => {
    const specs = resolveAgentSpecsForPhase({
      aaacRoot: AAAC_ROOT,
      phase: "discover",
      manifest: { verb: "check", command: "check-architecture" },
      count: 6,
    });

    expect(specs).toHaveLength(6);
    const ids = specs.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);

    const waveIds = ids.filter((id) => id.includes("-wave-"));
    expect(waveIds.length).toBeGreaterThan(0);

    for (const spec of specs) {
      const baseId = spec.id.replace(/-wave-\d+$/, "");
      expect(spec.cursorPath).toBe(`.cursor/agents/${baseId}.md`);
      expect(spec.path).toBe(`.cursor/agents/${baseId}.md`);
    }
  });

  it("every graph agent and repeated wave slot has a bounded Role summary", () => {
    const { agentPaths } = loadGraphSwarmConfig(AAAC_ROOT);
    for (const [id, relPath] of Object.entries(agentPaths)) {
      const content = fs.readFileSync(path.join(REPO_ROOT, ".cursor", relPath), "utf8");
      const summary = extractRoleInitialSummary(content);
      expect(summary, `${id} must expose a valid Role summary`).toBeTruthy();
      expect(summary.length, `${id} Role summary must stay bounded`).toBeLessThanOrEqual(180);
    }

    const waveSpecs = resolveAgentSpecsForPhase({
      aaacRoot: AAAC_ROOT,
      phase: "discover",
      manifest: { verb: "check", command: "check-architecture" },
      count: 9,
    });
    expect(waveSpecs.some((spec) => spec.id.includes("-wave-"))).toBe(true);
    for (const spec of waveSpecs) {
      const content = fs.readFileSync(path.join(REPO_ROOT, spec.path), "utf8");
      expect(extractRoleInitialSummary(content), spec.id).toBeTruthy();
    }
  });

  it.each(GRAPH_ROLE_CASES)(
    "accepts $label graph Role for $id with agent-spec provenance",
    ({ id, relPath, content }) => {
      const summary = extractRoleInitialSummary(content);
      const source = `agent-spec:.cursor/${relPath}#Role`;

      expect(validateInitialSummary(summary), `${id} initial summary`).toBe(summary);
      expect(source, `${id} source provenance`).not.toBe("");
      expect(validateStageSummaryEntry({
        layman: summary,
        source_artifacts: [source],
        metrics: {},
      }), `${id} stage summary`).toEqual({ ok: true });
    },
  );
});
