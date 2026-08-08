---
name: shared-implementation-review
description: >-
  Phase review_swarm — readonly agents review diff against docs and plan.
  Independent from execute agent. Not user-facing.
disable-model-invocation: true
---

# Implementation review (review_swarm phase)

## When

After `verify`, before `report`, on **create / update / fix / remove**.

**Hard rule:** The agent that ran `execute` must **not** perform this review — launch separate readonly Task subagents only.

## Swarm (mandatory)

Launch **3** parallel `Task` subagents (`explore`, `readonly: true`) in **one message**:

| Agent spec | Angle |
|------------|-------|
| [boundary-review.md](../../../agents/boundary-review.md) | Layer boundaries, fetch-in-UI, coupling |
| [doc-conformance.md](../../../agents/doc-conformance.md) | master_rules, policies, inventory |
| [implementation-review.md](../../../agents/implementation-review.md) | Plan scope, defects, budgets |

Every prompt **must** include [_task-prompt-policy.md](../_task-prompt-policy.md) plus: plan path, verify artifact, git diff summary or changed file list.

## Merge

Parent synthesizes Run `artifacts/review.yaml`:

```yaml
findings:
  - agent: boundary-review | doc-conformance | implementation-review
    severity: critical | suggestion
    finding: "<one line>"
    evidence: "<path:line>"
blocking_critical: <count>
pass: true | false
```

## Fail

If `blocking_critical` > 0 → return to `execute` or `test_execute` to fix, then re-run verify + review_swarm. Do **not** advance to `report` with open critical findings.

## Replaces

Self-review checklist in [governance/implementation](../governance/implementation/SKILL.md) — independent review happens here, not in execute.
