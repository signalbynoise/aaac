---
name: shared-root-cause
description: >-
  Deep root-cause framing after investigation swarm on fix paths. Not user-facing.
disable-model-invocation: true
---

# Root cause (fix only)

**When:** fix verb lifecycle — after [investigation](../investigation/SKILL.md) Mode A merge, before planning.

**Input:** Run artifact `artifacts/investigation.md` (required).

## Procedure

1. Synthesize swarm outputs into one hypothesis — cite `path:line` evidence
2. If any investigation agent had `confidence: low` **or** merged architecture confidence &lt; 0.85 → launch **1 parallel** [fix-hypothesis-validate.md](../../../agents/fix-hypothesis-validate.md) (`explore`, readonly)
3. If validator returns `investigate_more` → **STOP, REQUEST CLARIFICATION** or run second investigation wave (max 2 agents)
4. Write Run artifact `artifacts/root_cause.yaml`

## Output (mandatory)

```yaml
symptom: one line
root_cause: hypothesis with evidence (path:line)
contributing_factors: [optional bullets]
fix_strategy: minimal correct change (not symptom patch)
regression_risk: low | medium | high
root_cause_confidence: 0.0–1.0
validator_action: proceed | investigate_more | skipped
```

If `root_cause_confidence` &lt; **0.7** → **STOP, REQUEST CLARIFICATION** — do not plan or execute.

Feed `fix_strategy` and `regression_risk` into [impact-analysis](../impact-analysis/SKILL.md) and [rollback](../rollback/SKILL.md).
