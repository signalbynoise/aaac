---
name: shared-testing
description: >-
  Runs vitest and Fallow check_changed for AAAC workflows. Software pass/fail —
  not goal verification. Not user-facing.
disable-model-invocation: true
---

# Shared testing

## When

Phase `test` (and `test_only` orchestrators).

## Steps

1. Run tests from domain inventory relevant to change
2. Invoke [unit-test-run.md](../../../agents/unit-test-run.md) pattern for targeted vitest
3. Fallow MCP → `check_changed` on touched files when configured
4. `ReadLints` on edited paths

## Output

Pass/fail summary with test names and Fallow verdict for `verification` skill.
