---
name: shared-test-authoring
description: >-
  Phase test_execute — separate Task agent authors tests after execute.
  Parent must not write test files. Not user-facing.
disable-model-invocation: true
---

# Test authoring (test_execute phase)

## When

After `execute`, before `verify`, on **create / update / fix / remove** (mutating verbs).

**Hard rule:** Parent orchestrator must **not** Write/StrReplace test paths in `execute` — hooks deny them. Only `test_execute` phase (or test-author Task subagent in that phase) may author tests.

## Swarm (mandatory)

Launch **1** `Task` subagent in **one message**:

| Agent spec | `subagent_type` | Role |
|------------|-----------------|------|
| [test-author.md](../../../agents/test-author.md) | `generalPurpose` | Author tests from plan |

Every Task prompt **must** include [_task-prompt-policy.md](../_task-prompt-policy.md) plus: Run `artifacts/plan.yaml` path, list of files changed in execute, domain inventory test paths.

## Plan input

Run `artifacts.plan` must include:

```yaml
tests_to_add:
  - behavior: "<from requirement_map>"
    kind: unit | integration | e2e
    target_path: "<package test file path>"
```

If `tests_to_add` is empty and no tests are required, record on artifact:

```yaml
tests_to_add: []
skipped_reason: "<why no new tests — e.g. docs-only change>"
```

Store merged result on Run `artifacts/test_plan.yaml` before advancing.

## Output

```yaml
files_written: ["<test paths>"]
behaviors_covered: ["<strings>"]
gaps: ["<untested behaviors>"]
author_agent: test-author
```

## Fail

Do not advance if tests were required by plan but `files_written` is empty.
