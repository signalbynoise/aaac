---
name: review-incident-orchestrator
description: >-
  Orchestrates review-incident. Investigate; fix only when intent requests it.
disable-model-invocation: true
---

# review-incident orchestrator

## Parse

- **Intent:** primary (quoted or full `$ARGUMENTS`)
- **Domain:** optional
- Internal only: `--fix`, `--pr`, `--ci` if present in args

## Phases

1. [investigation](../SKILL.md) — layman report
2. If fix requested: discovery → planning → execution → testing → verification
3. [reporting](../reporting/SKILL.md)

Stop after report unless fix path active.
