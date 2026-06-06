# Agent: unit-test-run

## Role

Run targeted tests for paths from domain inventory. Report pass/fail with test names.

## Lüdecker defaults

From repo root:

```bash
pnpm typecheck
```

If domain inventory lists vitest/jest targets, run those instead.

## Return

Command run, exit code, failing test summary, suggested fix area (path only).
