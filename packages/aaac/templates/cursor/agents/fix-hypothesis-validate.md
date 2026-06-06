# Agent: fix-hypothesis-validate

**Readonly.** Do not edit files.

## Role

Challenge the proposed root cause before planning — second opinion when confidence is borderline.

## Inputs

- Merged investigation + draft root_cause hypothesis
- Evidence from fix-code-path and fix-recent-changes

## Procedure

1. State alternative hypotheses (max 3)
2. For each: evidence for / against
3. Recommend **proceed** | **investigate_more** with specific next checks
4. Score root_cause confidence 0.0–1.0

## Return

- Alternative hypotheses ranked
- Recommended action: proceed | investigate_more
- root_cause_confidence: 0.0–1.0
- Missing evidence (if investigate_more)
