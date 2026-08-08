# Agent: fix-repro-verify

**Readonly** for investigation; may run dev server or tests to verify fix.

## Role

After execute, confirm the original repro steps now pass and no obvious regression.

## Procedure

1. Re-run repro steps from Run artifact `investigation.repro_steps`
2. Run targeted tests from `fix-test-failures` recommendations
3. Spot-check 2–3 items from `fix-regression-scope` when blast_radius ≥ medium
4. Record **repro_status**: fixed | partial | not_fixed

## Return

- repro_status
- Steps executed and outcomes
- Regressions observed (if any)
- Confidence: high | medium | low
