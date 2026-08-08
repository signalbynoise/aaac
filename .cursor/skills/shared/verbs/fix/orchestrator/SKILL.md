---
name: verb-fix-orchestrator
description: Orchestrates fix-* resolver fallbacks and generic fix-{object} commands. Internal only.
disable-model-invocation: true
---

# fix-* orchestrator

**Object** from graph or resolver `default_object`. Domain resolver paths (`fix-module`, `fix-bug`, …) prefer `*-fix-bug` orchestrators — see [dispatch.md](../../../aaac/dispatch.md).

Read [_dispatch-utils.md](../_dispatch-utils.md) and [_lifecycle.md](../_lifecycle.md) first.

Contract: [contract.yaml](./contract.yaml)  
Command contracts: [fix-module.yaml](../../../aaac/contracts/commands/fix-module.yaml), [fix-bug.yaml](../../../aaac/contracts/commands/fix-bug.yaml)

Lifecycle: graph `verb_runtime.fix` or `command_workflows.fix-module` on Run

## Phases (deterministic — do not skip)

1. **policies** — all four including [minimal-complexity.md](../../../policies/minimal-complexity.md)
2. **load_inventory** — when `domains/<slug>/update/inventory/SKILL.md` exists
3. **discover** — [discovery](../../discovery/SKILL.md) — **4–6 parallel** agents, one message
4. **investigate_swarm** — [investigation](../../investigation/SKILL.md) Mode A — **7 parallel** agents, one message
5. **root_cause** — [root-cause](../../root-cause/SKILL.md) — optional [fix-hypothesis-validate](../../../agents/fix-hypothesis-validate.md)
6. **plan** — [planning](../../planning/SKILL.md) — minimal diff; `complexity_score` max **5**
7. **validate** — [validation](../../validation/SKILL.md)
8. **impact_analysis** — [impact-analysis](../../impact-analysis/SKILL.md)
9. **dependency_graph** — [dependency-graph](../../dependency-graph/SKILL.md)
10. **fitness_functions** — [fitness-functions](../../fitness-functions/SKILL.md)
11. **rollback** — [rollback](../../rollback/SKILL.md) when maturity protected/critical or blast_radius ≥ medium
12. **execute** — [execution](../../execution/SKILL.md)
13. **test_execute** — [test-authoring](../../test-authoring/SKILL.md) — **1** test-author Task agent
14. **verify** — [testing](../../testing/SKILL.md) fix verify swarm + [verification](../../verification/SKILL.md) — **3** subagents
15. **review_swarm** — [implementation-review](../../implementation-review/SKILL.md) — **3** readonly reviewers
16. **sync_inventory** — when domain inventory exists
17. **report** — [reporting](../../reporting/SKILL.md)

## Swarm anti-patterns (hard fail)

- Skipping discovery or investigate_swarm because the issue "looks simple"
- Sequential Task launches when parallel is required
- Execute before `root_cause_confidence` ≥ 0.7
- Claim success when `repro_status: not_fixed`

Gate failure → **STOP, REQUEST CLARIFICATION**
