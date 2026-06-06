# Verb orchestrator utilities (internal)

Graph paths (`agents/`, `policies/`, `skills/`, `domains/`) are relative to **`.cursor/`**.

## Lifecycle (create / update / fix)

**Work SSOT:** [lifecycle/lifecycle.json](../../../aaac/lifecycle/lifecycle.json) `work_phases`  
**Gates SSOT:** [governance/gates.json](../../../aaac/governance/gates.json)  
**Runtime:** graph `verb_runtime` — composed on Run at dispatch  
**Run protocol:** [run/SKILL.md](../../run/SKILL.md) + [_lifecycle.md](./_lifecycle.md)

Orchestrators execute phases from the Run `pending` queue. Do not skip gates unless user explicitly approves blocked run (record in Run `decisions[]`).

## Load policies (every orchestrator)

Read before any phase:

1. [.cursor/policies/master-rules.md](../../../policies/master-rules.md)
2. [.cursor/policies/implementation.md](../../../policies/implementation.md)
3. [.cursor/policies/mcp-and-deploy.md](../../../policies/mcp-and-deploy.md)
4. [.cursor/policies/minimal-complexity.md](../../../policies/minimal-complexity.md) — **required for create / update / fix**

## Minimal complexity (create / update / fix)

SSOT: [complexity.yaml](../../../aaac/complexity.yaml), [minimal-complexity.md](../../../policies/minimal-complexity.md)

| Phase | Responsibility |
|-------|----------------|
| **plan** | `requirement_map`, `complexity_score`, reuse/modify/create, rejected alternatives → Run `artifacts.plan` |
| **validate** | Confidence + plan fields + score ≤ threshold + YAGNI |
| **fitness_functions** | `minimal_complexity` pass (blocking) |

Optimization: **capability / complexity**, not capability alone. Default to reuse → extend → modify → create.

| Verb | Max complexity score |
|------|----------------------|
| fix | 5 |
| update | 8 |
| create | 12 |

## Confidence gates

Before `execute`, [validation](../../validation/SKILL.md) must pass:

| Dimension | Min |
|-----------|-----|
| architecture | 0.9 |
| requirements | 0.8 |
| scope | 0.8 |

Below threshold → set Run `status: blocked`, `awaiting_approval: true`, **STOP**

## Object maturity

From `object_maturity.<object>` + `maturity_rules`:

| Level | Extra phases |
|-------|----------------|
| protected | impact_analysis, dependency_graph, rollback (mandatory) |
| critical | impact_analysis, dependency_graph |
| stable | impact_analysis on fix |
| evolving | verb lifecycle only |

## Load domain inventory

When `$DOMAIN` slug maps to `domains/<slug>/update/inventory/SKILL.md`:

1. Read inventory **first** (constraints, out-of-scope, file map)
2. Pass inventory constraints into discovery, investigation-lite/investigation, planning, validation, execution, verification

If inventory missing and command is `fix-bug` / `fix-module` / `create-feature` / `update-module`:

- Run [module-authoring](../../module-authoring/SKILL.md) discovery to bootstrap domain, **or**
- Tell user to use generic verb command with intent

## Dependency graph

Before execute: [dependency-graph](../../dependency-graph/SKILL.md) resolves [dependencies.yaml](../../../aaac/dependencies.yaml) — not inventory alone.

## Load object skills

From [graph.yaml](../../../aaac/graph.yaml):

1. Read `commands.<cmd>.object`
2. Load every skill in `object_skills.<object>`
3. Load extra skills from `object_skill_verbs.<object>.<verb>` when present

See [_object-skills.md](./_object-skills.md) for verb-specific notes.

## Investigation depth

| Verb | Skill |
|------|-------|
| create, update | [investigation-lite](../../investigation-lite/SKILL.md) |
| fix, fix_mode | [investigation](../../investigation/SKILL.md) → [root-cause](../../root-cause/SKILL.md) |

Never skip investigation-lite on update because "change looks small."

## Pre-execute gate stack (not lifecycle work)

After `plan`, before `execute` — **gate** phases from [governance/gates.json](../../../aaac/governance/gates.json):

1. validate
2. impact_analysis
3. dependency_graph
4. fitness_functions
5. rollback (when required by maturity or impact)

On gate fail: block Run, await human approval. See [validation](../../validation/SKILL.md).
