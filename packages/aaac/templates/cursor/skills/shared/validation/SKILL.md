---
name: shared-validation
description: >-
  Confidence gates before execute. STOP and request clarification when thresholds
  not met. Not user-facing.
disable-model-invocation: true
---

# Validation (confidence gates)

**When:** After plan, **before** impact_analysis / execute.

## Thresholds (SSOT)

From [ontology.json](../../../aaac/ontology.json) `confidence`:

| Dimension | Minimum |
|-----------|---------|
| architecture | 0.9 |
| requirements | 0.8 |
| scope | 0.8 |

## Inputs

- Plan from [planning](../planning/SKILL.md)
- Confidence scores from [investigation-lite](../investigation-lite/SKILL.md) or [investigation](../investigation/SKILL.md) + [root-cause](../root-cause/SKILL.md)
- Domain inventory constraints

## Procedure

1. Score each dimension 0.0–1.0 with one-line evidence
2. Compare to thresholds
3. If **any** below threshold:

```yaml
status: blocked
awaiting_approval: true
blocked_reason: "confidence.{dimension} {score} below {threshold}"
```

```text
STOP — awaiting approval
Reason: {blocked_reason}
Run: {run_id}
```

List specific questions for the user. **Do not proceed to execute** until user approves in chat.

4. Record scores on Run `confidence` and gate result in `gates.results.validate`
5. If at threshold: emit gate pass, continue gate stack

## Plan sanity checks

- Plan respects inventory out-of-scope
- Plan names files to touch (no vague "update CMS")
- Protected/critical objects include rollback mention in plan or next rollback phase
