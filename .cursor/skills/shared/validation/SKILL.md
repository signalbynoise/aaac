---
name: shared-validation
description: >-
  Confidence and complexity gates before execute on create/update/fix.
  STOP and request clarification when thresholds not met. Not user-facing.
disable-model-invocation: true
---

# Validation (confidence + complexity gates)

**When:** After `plan`, **before** impact_analysis / execute.

**Applies to:** `create`, `update`, `fix` (see [complexity.yaml](../../../aaac/complexity.yaml) `mutating_verbs`).

## Thresholds — confidence (SSOT)

From [ontology.json](../../../aaac/ontology.json) `confidence`:

| Dimension | Minimum |
|-----------|---------|
| architecture | 0.9 |
| requirements | 0.8 |
| scope | 0.8 |

## Thresholds — complexity (SSOT)

From [complexity.yaml](../../../aaac/complexity.yaml):

| Verb | Max `complexity_score` |
|------|------------------------|
| fix | 5 |
| update | 8 |
| create | 12 |

## Inputs

- Plan from [planning](../planning/SKILL.md) → Run `artifacts.plan`
- Confidence scores from investigation path
- Domain inventory constraints
- [minimal-complexity.md](../../../policies/minimal-complexity.md)

## Procedure

### 1. Confidence

1. Score each dimension 0.0–1.0 with one-line evidence
2. Compare to thresholds

### 2. Plan / complexity (mutating verbs only)

1. Verify Run `artifacts.plan` has: `requirement_map`, `complexity_score`, `reuse`, `modify`, `create`, `rejected_alternatives`
2. Every `create[]` entry must have `requirement_ref` and `why_not_reuse`
3. Each requirement in user intent must appear in `requirement_map`
4. Compare `complexity_score` to verb threshold
5. Scan plan for YAGNI phrases ([complexity.yaml](../../../aaac/complexity.yaml) `yagni.reject_without_user_evidence`) — fail unless user intent cites the same need
6. **fix:** plan must prioritize `modify` over `create`; score > 5 → fail

### 3. Fail → block Run

If confidence below threshold **or** complexity checks fail:

```yaml
status: blocked
awaiting_approval: true
blocked_reason: "<specific reason>"
```

```text
STOP — awaiting approval
Reason: {blocked_reason}
Run: {run_id}
```

List specific questions. **Do not proceed to execute** until user approves or plan is revised.

### 4. Pass

Record on Run:

- `confidence` scores
- `gates.results.validate`
- `artifacts.plan` complexity fields

Continue gate stack.

## Plan sanity checks

- Plan respects inventory out-of-scope
- Plan names files to touch (no vague "update CMS")
- Protected/critical objects include rollback mention
- No new service/table/queue/state machine without matching `requirement_map` entry
