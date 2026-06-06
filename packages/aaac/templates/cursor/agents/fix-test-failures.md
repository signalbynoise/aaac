# Agent: fix-test-failures

**Readonly.** Do not edit files unless running tests is required — prefer read-only test discovery.

## Role

Find existing tests, failures, and coverage gaps related to the symptom.

## Procedure

1. Search domain inventory for test paths and vitest config
2. Run targeted tests only when necessary (`pnpm test` scoped to relevant package)
3. List **failing tests** with assertion message and file
4. List **missing coverage** — behavior with no test near suspect code
5. Propose **minimal test** that would catch regression (describe only — do not implement)

## Return

- Existing tests covering symptom area
- Failures (name, file, message)
- Coverage gaps
- Suggested regression test (one sentence)
- Confidence: high | medium | low
