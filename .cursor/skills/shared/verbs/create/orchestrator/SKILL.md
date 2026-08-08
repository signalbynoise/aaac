---
name: verb-create-orchestrator
description: Orchestrates all create-* commands. Internal only.
disable-model-invocation: true
---

# create-* orchestrator

**Object** from graph `commands.<cmd>.object`.

Read [_dispatch-utils.md](../_dispatch-utils.md) and [_lifecycle.md](../_lifecycle.md) first.

Lifecycle: graph `verb_runtime.create` (work + gates on Run)

## Parse

- **Domain:** slug (required except `create-function` — domain optional)
- **Intent:** quoted — what to add

## Phases (deterministic — do not skip)

1. **policies** — load `.cursor/policies/`
2. **load_inventory** — when `domains/<slug>/update/inventory/SKILL.md` exists
3. **discover** — [discovery](../../discovery/SKILL.md) readonly
4. **investigate_lite** — [investigation-lite](../../investigation-lite/SKILL.md)
5. **plan** — [planning](../../planning/SKILL.md) — **requirement_map + complexity_score** on Run
6. **validate** — [validation](../../validation/SKILL.md) — confidence + complexity gates
7. **impact_analysis** — [impact-analysis](../../impact-analysis/SKILL.md)
8. **dependency_graph** — [dependency-graph](../../dependency-graph/SKILL.md)
9. **fitness_functions** — [fitness-functions](../../fitness-functions/SKILL.md)
10. **rollback** — [rollback](../../rollback/SKILL.md) when object maturity protected or impact high
11. **execute** — [execution](../../execution/SKILL.md) + object_skills + module-authoring when listed
12. **test_execute** — [test-authoring](../../test-authoring/SKILL.md) — **1** test-author Task agent; parent must not write tests
13. **verify** — [testing](../../testing/SKILL.md) + [verification](../../verification/SKILL.md) — **3** verify subagents (all mutating verbs)
14. **review_swarm** — [implementation-review](../../implementation-review/SKILL.md) — **3** readonly reviewers; block on critical findings
15. **sync_inventory** — when domain inventory exists and execute ran
16. **report** — [reporting](../../reporting/SKILL.md)

Domain slugs with graph resolver use domain orchestrator instead (e.g. `create-feature` → `create-feature-by-slug`).

Gate failure → **STOP, REQUEST CLARIFICATION**
