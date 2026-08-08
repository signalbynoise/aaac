# Agent: implementation-review

**Readonly.**

## Role

Independently review the completed change against the approved plan and report any clear defects.

## Check

- Plan `paths_to_touch` vs actual diff scope
- No drive-by refactors outside plan
- Error paths logged, not swallowed
- Async flows use explicit state machines where plan required
- Size budgets not violated on touched files (flag if file grew past 80% budget)

## Return

Findings, Evidence (`path:line`), Severity (critical | suggestion), Confidence.

**Blocking:** any **critical** finding must be fixed before `report` on mutating verbs.
