---
name: shared-impact-analysis
description: >-
  Pre-execute impact analysis — what can break, risk tags. Required for update and
  fix; recommended for create on critical/protected objects. Not user-facing.
disable-model-invocation: true
---

# Impact analysis

**When:** Verb lifecycle phase `impact_analysis` — after validate, before execute.

## Question

```text
What can break?
```

## Procedure

1. Read planned file/route/migration list from plan
2. Cross-reference [dependencies.yaml](../../../aaac/dependencies.yaml) `risk_tags` and domain `depends_on`
3. Invoke [impact-analysis.md](../../../agents/impact-analysis.md) agent pattern (readonly)

## Output (mandatory)

```yaml
affected:
  - cms | ui | database | integration | ...
risk:
  - migrations
  - breaking_contracts
  - auth
  - deployment
blast_radius: low | medium | high
proceed: yes | no — if high blast_radius on protected object without rollback → no
```

If `proceed: no` → **STOP, REQUEST CLARIFICATION** or require completed [rollback](../rollback/SKILL.md) plan.

## Maturity

- **protected** / **critical** objects: always run full analysis
- **stable** / **evolving**: run; may downgrade to brief bullet list if blast_radius low
