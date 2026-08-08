---
name: shared-planning
description: >-
  Plans AAAC changes: SSOT, layers, size budgets, complexity score, requirement map.
  Readonly until orchestrator approves. Mutating verbs only.
disable-model-invocation: true
---

# Shared planning

## When

After `discover` / `investigate*` on **`create`, `update`, `fix`** commands. **Does not edit files.**

Other verbs: lightweight plan only (no complexity artifact).

## Policies (mutating verbs)

Read before planning:

- [minimal-complexity.md](../../../policies/minimal-complexity.md)
- [complexity.yaml](../../../aaac/complexity.yaml) — weights and thresholds

## Agents

Optional parallel readonly:

- [plan-layer-map.md](../../../agents/plan-layer-map.md)
- [plan-state-machines.md](../../../agents/plan-state-machines.md)

## Strategy (mandatory for create / update / fix)

Search codebase first. Document in plan **before** proposing new artifacts:

```text
1. reuse_existing
2. extend_existing
3. modify_existing
4. create_new  ← last resort; each entry needs requirement_ref + why_not_reuse
```

Prefer **lower complexity score** when multiple options satisfy requirements.

## Plan artifact (store on Run `artifacts.plan`)

Contract: [contracts/skills/planning.yaml](../../../aaac/contracts/skills/planning.yaml)

```yaml
requirement_map:
  - requirement: "<from user intent — quoted if possible>"
    satisfies_with: ["<artifact ids>"]
complexity_score: <sum of weights for net-new items>
complexity_breakdown:
  new_file: 0
  new_api_endpoint: 0
  # … per complexity.yaml weights
reuse: ["<existing paths or symbols>"]
modify: ["<existing paths to edit>"]
create:
  - artifact: "<name>"
    kind: <weight key from complexity.yaml>
    requirement_ref: "<requirement text>"
    why_not_reuse: "<one line>"
rejected_alternatives:
  - option: "<heavier approach>"
    complexity_score: <number>
    rejected_because: "<no requirement / reuse suffices>"
paths_to_touch: ["<concrete file paths>"]
tests_to_add:
  - behavior: "<from requirement_map>"
    kind: unit | integration | e2e
    target_path: "<test file path>"
rollback_notes: "<when protected/critical object>"
```

Also include:

- SSOT owner for new state
- Extract before add if any file ≥80% budget
- Named machine states/events **only** if user requirement demands async coordination
- **`tests_to_add[]`** — behaviors needing new tests (see [test-authoring](../test-authoring/SKILL.md)); empty array with reason when docs-only

## Complexity score

Sum `complexity.yaml` weights for each net-new artifact in `create`. **Edits to existing files do not add weight** (count under `modify`).

Compare to verb threshold:

| Verb | Max |
|------|-----|
| fix | 5 |
| update | 8 |
| create | 12 |

If over threshold: revise plan toward reuse/modify or document in `rejected_alternatives` and stop for gate — do not proceed to execute silently.

## YAGNI

Do not plan for unstated future needs. See [minimal-complexity.md](../../../policies/minimal-complexity.md).

Orchestrator gates `execute` — no implementation until plan passes **validate** and **fitness_functions** (`minimal_complexity`).
