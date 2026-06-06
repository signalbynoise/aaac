---
name: test-function-orchestrator
description: Orchestrates test-function — targeted journey/integration verification. Internal only.
disable-model-invocation: true
---

# test-function orchestrator

## Parse

- **Intent:** required — describes user journey (e.g. "add new user to project")
- **Domain:** optional slug in args for scope hint

## Phases

1. [discovery](../discovery/SKILL.md) — map journey to files/tests
2. [planning](../planning/SKILL.md) — which tests to run or add
3. [testing](../testing/SKILL.md) — run vitest/e2e as appropriate
4. [verification](../verification/SKILL.md) — journey criteria met?
5. [reporting](../reporting/SKILL.md)

Code changes only if intent explicitly requests fixing failures (then `execution`).
