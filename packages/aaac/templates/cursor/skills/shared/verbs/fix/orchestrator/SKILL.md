---
name: verb-fix-orchestrator
description: Orchestrates fix-* except fix-bug resolver paths. Internal only.
disable-model-invocation: true
---

# fix-* orchestrator

**Object** from graph. `fix-bug` uses domain resolver (see [dispatch.md](../../../aaac/dispatch.md) for fallback).

Read [_dispatch-utils.md](../_dispatch-utils.md) and [_lifecycle.md](../_lifecycle.md) first.

Lifecycle: graph `verb_runtime.fix` (work + gates on Run)

## Phases (deterministic — do not skip)

1. **policies**
2. **load_inventory** — when domain inventory exists
3. **discover** — [discovery](../../discovery/SKILL.md) readonly
4. **investigate** — [investigation](../../investigation/SKILL.md) deep
5. **root_cause** — [root-cause](../../root-cause/SKILL.md)
6. **plan** — [planning](../../planning/SKILL.md)
7. **validate** — [validation](../../validation/SKILL.md)
8. **impact_analysis** — [impact-analysis](../../impact-analysis/SKILL.md)
9. **dependency_graph** — [dependency-graph](../../dependency-graph/SKILL.md)
10. **fitness_functions** — [fitness-functions](../../fitness-functions/SKILL.md)
11. **rollback** — [rollback](../../rollback/SKILL.md) when maturity protected/critical or blast_radius ≥ medium
12. **execute** — [execution](../../execution/SKILL.md)
13. **verify** — [testing](../../testing/SKILL.md) + [verification](../../verification/SKILL.md)
14. **sync_inventory**
15. **report** — [reporting](../../reporting/SKILL.md)

Gate failure → **STOP, REQUEST CLARIFICATION**
