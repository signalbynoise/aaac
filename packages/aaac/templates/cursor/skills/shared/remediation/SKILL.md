---
name: shared-remediation
description: Remediation campaign loop — scan, check, fix waves, regression gates, debt sweep, satisfaction.
disable-model-invocation: true
---

# Used by `/remediate-app`. See [orchestrator/SKILL.md](./orchestrator/SKILL.md).

**Autonomous campaigns:** [babysit/SKILL.md](./babysit/SKILL.md) is **auto-required** when `campaign.config.autonomous` (see `artifacts/autonomous_bootstrap.json`).

## Agentic OS loop

```text
Planner (check_swarm mirrors check-app + check-architecture → plan_waves)
  ↓
Executor (fix wave)
  ↓
Validator — regression gate (remediator-gate --mode wave)
  ↓
Remediator (fix-module / fix-bug)  ← exit 3 = CONTINUE, not stop
  ↓
Validator retry (attempt++)
  ↓
Promote wave (no new regression) → next wave
  ↓
Debt sweep — strict gate (debt-sweep-gate)
  ↓
Remediator loop until all layers green
  ↓
Satisfaction gate → report (validate-campaign-complete first)
```

## Two-tier validation

| Tier | Script | Pass when |
|------|--------|-----------|
| Regression | `remediator-gate --mode wave` | Errors did not **increase** vs pre-wave snapshot |
| Strict | `debt-sweep-gate` | All layers pass; `total_errors === 0` |

## Loop invariant

Every iteration must persist:

1. Verify baseline (campaign start)
2. Fallow scan snapshot
3. Pre-wave snapshots + wave verify reports
4. Debt sweep state + verify-debt.json
5. Full logs in `verify-logs/*.log`
6. Satisfaction score

**Exit 3 never ends the campaign.** Pre-existing debt never blocks cleanup waves.
