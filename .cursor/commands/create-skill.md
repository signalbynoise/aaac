# create-skill

AAAC: `/create-skill <domain> "<intent>"`

**Layer:** code  
**Create something new** a **module** (alias `create-skill` → `create-module`) — Bounded domain package (service, library, plugin).

## Dispatch

1. [.cursor/aaac/dispatch.md](../aaac/dispatch.md)
2. [.cursor/aaac/graph.yaml](../aaac/graph.yaml) — **`create-skill`**
3. alias → `create-module`

Domain slug recommended.


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

