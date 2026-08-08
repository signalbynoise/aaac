---
name: verb-update-orchestrator
description: Orchestrates update-* commands without dedicated resolver. Internal only.
disable-model-invocation: true
---

# update-* orchestrator

**Object** from graph. Resolvers win: `update-module`, `update-architecture`, `update-component` (alias: `update-design`).

Read [_dispatch-utils.md](../_dispatch-utils.md) and [_lifecycle.md](../_lifecycle.md) first.

Lifecycle: graph `verb_runtime.update` (work + gates on Run)

## Phases (deterministic — do not skip)

1. **policies**
2. **load_inventory** — when domain inventory exists
3. **discover** — [discovery](../../discovery/SKILL.md)
4. **investigate_lite** — [investigation-lite](../../investigation-lite/SKILL.md) — **mandatory** (what exists, depends on, constraints)
5. **plan** — [planning](../../planning/SKILL.md) — **requirement_map + complexity_score** (max 8)
6. **validate** — [validation](../../validation/SKILL.md) — confidence + complexity gates
7. **impact_analysis** — [impact-analysis](../../impact-analysis/SKILL.md)
8. **dependency_graph** — [dependency-graph](../../dependency-graph/SKILL.md)
9. **fitness_functions** — [fitness-functions](../../fitness-functions/SKILL.md)
10. **rollback** — [rollback](../../rollback/SKILL.md) when maturity protected or blast_radius high
11. **execute** — [execution](../../execution/SKILL.md); `design_mode` when component + design resolver
12. **test_execute** — [test-authoring](../../test-authoring/SKILL.md) — **1** test-author Task agent
13. **verify** — [testing](../../testing/SKILL.md) + [verification](../../verification/SKILL.md) — **3** verify subagents
14. **review_swarm** — [implementation-review](../../implementation-review/SKILL.md) — **3** readonly reviewers
15. **sync_inventory**
16. **report** — [reporting](../../reporting/SKILL.md)

Intent `Sync inventory only` → inventory sync only, no execution.

Gate failure → **STOP, REQUEST CLARIFICATION**
