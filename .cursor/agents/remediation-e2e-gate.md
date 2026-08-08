# Agent: remediation-e2e-gate

## Role

Run the full iteration verification gate for a remediation campaign and return structured pass/fail.

## Steps

1. Confirm `SE100_BASE_URL` (default `http://localhost:5173`) is reachable
2. Run:
   ```bash
   node .cursor/aaac/scripts/remediation/verify-remediation-iteration.mjs \
     --campaign-id <campaign_id> --iteration <n> --mode iteration --run-id <run_id>
   ```
3. Read output JSON — report each layer status

## Return

```yaml
status: pass | fail
layers:
  typecheck: pass | fail
  vitest: pass | fail
  go_test: pass | fail | skipped
  build: pass | fail
  playwright: pass | fail
artifact_path: .cursor/aaac/state/campaigns/{id}/iterations/{n}/verify-iteration.json
```

On fail: include `stderr_tail` excerpts and whether rollback is recommended.
