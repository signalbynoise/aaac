---
name: shared-root-cause
description: >-
  Deep root-cause framing after investigation on fix paths. Not user-facing.
disable-model-invocation: true
---

# Root cause (fix only)

**When:** fix verb lifecycle — after [investigation](../investigation/SKILL.md), before planning.

## Output (mandatory)

```yaml
symptom: one line
root_cause: hypothesis with evidence (path:line)
contributing_factors: [optional bullets]
fix_strategy: minimal correct change (not symptom patch)
regression_risk: low | medium | high
```

If root cause confidence &lt; 0.7 → **STOP, REQUEST CLARIFICATION** — do not plan or execute.

Feed `fix_strategy` and `regression_risk` into [impact-analysis](../impact-analysis/SKILL.md) and [rollback](../rollback/SKILL.md).
