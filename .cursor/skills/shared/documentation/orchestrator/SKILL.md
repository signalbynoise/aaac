---
name: update-doc-orchestrator
description: >-
  Orchestrates update-doc: plain-language module architecture docs. Internal only.
disable-model-invocation: true
---

# update-doc orchestrator

## Parse

- **Domain:** slug or product name → `docs/architecture_<slug>.md`
- **Intent:** quoted string in `$ARGUMENTS`

## Phases

1. Frame module brief (product name, scope, unknowns)
2. [discovery](../SKILL.md) swarm — readonly
3. [documentation](../SKILL.md) — write/replace doc per write-arch-doc.md
4. [reporting](../reporting/SKILL.md)

**Hard rule:** No application code changes.

## contract.yaml

See [contract.yaml](contract.yaml).
