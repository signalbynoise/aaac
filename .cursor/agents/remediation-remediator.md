# Agent: remediation-remediator

## Role

Apply the requested cleanup fixes, repeat the review, and continue until the work passes or reaches a genuine block.

## Critical rule

**Exit 3 is not a stop signal.** The parent orchestrator must:

1. Apply the handoff inline
2. Re-run the gate with `--attempt N+1` (or debt-sweep retry_command)
3. Repeat until promote (exit 0) or true block (exit 1 after debt sweep exhaustion)

Never set `campaign.status=blocked` on exit 3. Never skip remaining waves.

## Trigger

```bash
node .cursor/aaac/scripts/remediation/remediator-gate.mjs \
  --campaign-id <id> --iteration <n> --mode wave|debt \
  --wave-index <w> --run-id <run_id> --attempt 1
```

Read stdout JSON. When `action === "remediate"` OR `orchestrator_must_not_stop === true`:

- Apply handoff **inside parent `execute` or `debt_sweep` phase** (same chat — no nested Run)

## Handoff fields

| Field | Use |
|-------|-----|
| `handoff.command` | `fix-module` or `fix-bug` |
| `handoff.domain` | e.g. `frontend`, `backend` |
| `handoff.intent` | Full intent including validator output |
| `handoff.file_paths` | Prioritize these files |
| `handoff.log_path` | **Read full log** — primary evidence source |
| `handoff.layer` | Failed layer |
| `retry_command` | Exact re-run command after fix |

## Evidence (mandatory)

1. Read `handoff.log_path` or `iterations/{n}/verify-logs/{mode}-{layer}.log`
2. Do **not** rely on truncated `stderr_tail` alone
3. For wave regression handoffs, fix only **introduced** layers (`introduced_layers` in payload)

## Execution

1. Load `iterations/{n}/remediator-handoff-attempt-{attempt}.json`
2. Run fix-module / fix-bug **inline** (discover → execute → test_execute → verify)
3. Re-run gate using `retry_command` from payload
4. Repeat until `action: promote` | `promote_wave` | `defer_to_debt_sweep` | `debt_sweep_complete`

## Wave vs debt

| Mode | Fix scope |
|------|-----------|
| `wave` | Only layers in `introduced_layers` (new regression) |
| `debt` | All failing layers until strict pass |

## Return

```yaml
status: promoted | deferred | debt_sweep_complete | remediate_again
attempt: number
max_attempts: number
layers_fixed: []
remaining_failures: []
```
