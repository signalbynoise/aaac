# Agent: unit-test-run

## Role

Run targeted tests for paths from domain inventory. Report pass/fail with test names.

## Defaults

From repo root, use the test command in domain inventory when listed (e.g. `pnpm test`, `npm test`, `cargo test`).

If no inventory entry, run the project's root `package.json` `test` or `typecheck` script when present.

## Return

Command run, exit code, failing test summary, suggested fix area (path only).
