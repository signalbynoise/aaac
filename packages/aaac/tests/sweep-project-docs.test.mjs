import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildRecommendations,
  formatInstallSweepReport,
  runInstallSweep,
  sweepProjectDocs,
} from "../src/lib/sweep-project-docs.mjs";

function write(relPath, content, root) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe("sweep-project-docs", () => {
  it("classifies docs, rules, and framework markdown", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-sweep-"));
    try {
      write("docs/custom-guide.md", "# Guide", root);
      write("docs/master_rules.md", "# Rules", root);
      write(".cursor/rules/team.mdc", "rule", root);
      write("AGENTS.md", "# Agents", root);
      write(".cursor/aaac/ontology.md", "# Ontology", root);
      write(".cursor/skills/shared/discovery/SKILL.md", "# Discovery", root);
      write("node_modules/evil/readme.md", "# No", root);

      const inventory = sweepProjectDocs(root, { docsRoot: "docs" });

      expect(inventory.docs).toContain("docs/custom-guide.md");
      expect(inventory.docs).toContain("docs/master_rules.md");
      expect(inventory.rules).toContain(".cursor/rules/team.mdc");
      expect(inventory.rules).toContain("AGENTS.md");
      expect(inventory.framework).toContain(".cursor/aaac/ontology.md");
      expect(inventory.framework).toContain(
        ".cursor/skills/shared/discovery/SKILL.md",
      );
      expect(inventory.docs).not.toContain("node_modules/evil/readme.md");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("recommends review when template docs existed before init", () => {
    const before = {
      docs: ["docs/master_rules.md", "docs/legacy.md"],
      rules: [],
      framework: [],
    };
    const after = {
      docs: ["docs/master_rules.md", "docs/project_context.md"],
      rules: [".cursor/rules/aaac-enforcement.mdc"],
      framework: [".cursor/aaac/ontology.md"],
    };

    const recs = buildRecommendations({ before, after, docsRoot: "docs" });
    const kinds = recs.map((r) => r.kind);

    expect(kinds).toContain("review_overwrite");
    expect(kinds).toContain("no_auto_merge");
    expect(recs.find((r) => r.kind === "review_overwrite")?.message).toMatch(
      /master_rules\.md/,
    );
  });

  it("writes install sweep report to aaac state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aaac-sweep-write-"));
    try {
      write("docs/master_rules.md", "# A", root);

      const { reportPath, markdown } = runInstallSweep(root, {
        docsRoot: "docs",
        projectName: "demo",
        before: { docs: ["docs/master_rules.md"], rules: [], framework: [] },
      });

      expect(fs.existsSync(reportPath)).toBe(true);
      expect(reportPath).toMatch(/install-sweep-report\.md$/);
      expect(markdown).toMatch(/docs \/ rules \/ framework inventory/);
      expect(markdown).toMatch(/Recommendations/);
      expect(markdown).toMatch(/review_overwrite/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("formatInstallSweepReport lists all categories", () => {
    const md = formatInstallSweepReport({
      before: { docs: [], rules: [], framework: [] },
      after: {
        docs: ["docs/a.md"],
        rules: ["AGENTS.md"],
        framework: [".cursor/aaac/dispatch.md"],
      },
      docsRoot: "docs",
      projectName: "x",
      installedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(md).toContain("## Docs");
    expect(md).toContain("`docs/a.md`");
    expect(md).toContain("## Rules");
    expect(md).toContain("`AGENTS.md`");
    expect(md).toContain("## Framework");
  });
});
