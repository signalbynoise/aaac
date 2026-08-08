# bug-fix

AAAC: `/bug-fix <domain> "<intent>"`

**Layer:** product  
**Repair something broken** a **bug** — full fix swarm (discovery + 7-agent investigate_swarm + root cause + gates + repro verify).

> Alias → `/fix-bug`. See [fix-bug.md](fix-bug.md).


## Dispatch

1. [.cursor/aaac/dispatch.md](../aaac/dispatch.md)
2. [.cursor/aaac/graph.yaml](../aaac/graph.yaml) — **`fix-bug`**
3. [verb-fix orchestrator](../skills/shared/verbs/fix/orchestrator/SKILL.md) — object `feature`
4. [investigation/SKILL.md](../skills/shared/investigation/SKILL.md) Mode A

Domain slug optional.

## Swarm (mandatory)

| Phase | Agents | Parallel |
|-------|--------|----------|
| discover | discovery-inventory, discovery-boundaries, discovery-ssot | 4–6 |
| investigate_swarm | fix-repro, fix-code-path, fix-recent-changes, fix-test-failures, fix-regression-scope, fix-runtime-evidence, fix-inventory-confirm | **7** |
| root_cause | parent + optional fix-hypothesis-validate | 0–1 |
| verify | fix-repro-verify, unit-test-run, fallow-check-changed | **3** |

Contract: [fix-bug.yaml](../aaac/contracts/commands/fix-bug.yaml)

## Example

```text
/bug-fix payments "Webhook handler drops events on retry"
/bug-fix api "Auth middleware returns 500 on expired token"
```


## Execute vs test_execute (mandatory)

| Phase | Allowed edits | Blocked |
|-------|---------------|---------|
| **execute** | Production/source files | `*.test.*`, `*.spec.*`, `__tests__/` |
| **test_execute** | Test files only | Production/source paths |

**Rules:**

1. `artifacts/plan.yaml` must include **`tests_to_add`** (behaviors to cover, or `tests_to_add: []` when truly none).
2. In **test_execute**, launch **1** [test-author](../../agents/test-author.md) Task agent — parent must not author tests in execute.
3. `artifacts/test_plan.yaml` must list **`files_written`** when `tests_to_add` is non-empty, or **`skipped_reason`** when `tests_to_add: []`.
4. **`status: deferred` is invalid** — hooks block test writes in execute; deferral is not a substitute for the test_execute phase.

If execute hits `phase cannot edit this path` for a test file, **advance to test_execute** and author tests there — do not bypass with a hollow `test_plan.yaml`.
