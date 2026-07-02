# remediate-app

AAAC: `/remediate-app [domain] "<intent>"`

**Layer:** system  
**Campaign loop** — Fallow suite (dead-code + dupes + health) → check swarm → ranked fix waves → **regression wave gates** → **mandatory debt sweep** → satisfaction loop.

## Dispatch

1. [.cursor/aaac/dispatch.md](../aaac/dispatch.md)
2. [.cursor/aaac/graph.yaml](../aaac/graph.yaml) — **`remediate-app`**
3. [skills/shared/remediation/orchestrator/SKILL.md](../skills/shared/remediation/orchestrator/SKILL.md)

## Hard invariants

- **Exit 3 = continue** — never stop the campaign on `remediate` handoff
- **Waves use regression gate** — pre-existing TS/vitest debt does not block cleanup waves
- **Debt sweep is mandatory** — all layers must pass before report
- **All planned waves must run** — no skipping on verify failure
- **Satisfaction exit 3 = next iteration** — never report when score < threshold and iterations remain
- **Fallow start baselines are immutable** — `fallow-start-baseline.json` (dead-code), `fallow-start-dupes-baseline.json`, `fallow-start-health-baseline.json` set once at campaign start (dupes/health auto-backfill on first scan if missing)
- **Fallow false positives excluded from satisfaction** — dead-code score uses actionable issues; dupes uses `clone_groups`; health uses `health_score`

## Intent tokens

| Token | Default | Example |
|-------|---------|---------|
| `max_iterations` | `5` | `max_iterations=8` |
| `max_waves_per_iteration` | `3` | `max_waves_per_iteration=2` |
| `max_debt_sweep_rounds` | `10` | `max_debt_sweep_rounds=15` |
| `max_remediator_attempts_per_wave` | `3` | `max_remediator_attempts_per_wave=5` |
| `max_remediator_attempts_per_debt_round` | `3` | `max_remediator_attempts_per_debt_round=5` |
| `satisfaction_threshold` | `85` | `satisfaction_threshold=90` |
| `autonomous` | auto when threshold≥100 or max_iterations≥10 | `autonomous` / `manual` |
| `resume` | — | `resume campaign_20260617_abc123` |

## Example

```text
/remediate-app "whole repo; max_iterations=5; satisfaction_threshold=85"
/remediate-app cms "Fallow cleanup until regression clean"
/remediate-app cms "manual; max_iterations=3"
```

Ensure dev server is running when Playwright is enabled — see `project.config.json` → `remediation.verify.dev_server`.

## Two-tier verification

### Wave gate (regression — after each fix wave)

```bash
node .cursor/aaac/scripts/remediation/capture-wave-snapshot.mjs \
  --campaign-id <id> --iteration <n> --wave-index <w>

node .cursor/aaac/scripts/remediation/remediator-gate.mjs \
  --campaign-id <id> --iteration <n> --mode wave --wave-index <w> \
  --run-id <run_id> --attempt 1
```

Promotes when errors did **not increase** vs pre-wave snapshot. Pre-existing debt is deferred to debt sweep.

**Exit 3** → run [remediation-remediator.md](../agents/remediation-remediator.md) → `--attempt N+1` → **do not stop**.

### Debt sweep (strict — after all waves)

```bash
node .cursor/aaac/scripts/remediation/debt-sweep-gate.mjs \
  --campaign-id <id> --iteration <n> --run-id <run_id> --round 1 --attempt 1
```

Loops until typecheck, vitest, go test, build, and Playwright all pass.

### Satisfaction loop (after debt sweep)

```bash
node .cursor/aaac/scripts/remediation/compute-satisfaction.mjs \
  --campaign-id <id> --iteration <n>

node .cursor/aaac/scripts/remediation/satisfaction-loop-gate.mjs \
  --campaign-id <id> --iteration <n> --run-id <run_id> --advance
```

| Code | Meaning |
|------|---------|
| `0` + `complete` | Threshold met → allow `report` |
| `0` + `partial_complete` | Max iterations → allow partial `report` |
| `3` + `continue_loop` | Score below threshold → **iteration N+1, return to scan** |

### Campaign complete check

```bash
node .cursor/aaac/scripts/remediation/validate-campaign-complete.mjs \
  --campaign-id <id> --iteration <n> --require-debt-sweep --require-satisfaction-loop
```

### Repair corrupted Fallow baseline (legacy campaigns)

```bash
node .cursor/aaac/scripts/remediation/repair-fallow-start-baseline.mjs \
  --campaign-id <id> --total 1649 --dupes-clone-groups 171 --health-score 87.7
```

## Fallow scan suite (scan phase)

`fallow-scan.mjs` runs three Fallow commands from `frontend/`:

| Layer | Command | Artifact | Baseline file | Scoring metric |
|-------|---------|----------|---------------|----------------|
| Dead code | `fallow dead-code` | `iterations/{n}/fallow-scan.json` | `fallow-start-baseline.json` | actionable issues (excludes FP) |
| Dupes | `fallow dupes` | `iterations/{n}/fallow-dupes.json` | `fallow-start-dupes-baseline.json` | `clone_groups` reduction |
| Health | `fallow health --score` | `iterations/{n}/fallow-health.json` | `fallow-start-health-baseline.json` | `health_score` improvement |

Combined summary: `iterations/{n}/fallow-scan-bundle.json`

### Satisfaction weights (40% Fallow total)

| Component | Weight |
|-----------|--------|
| `fallow_dead_code` | 0.25 |
| `fallow_dupes` | 0.10 |
| `fallow_health` | 0.05 |
| `structural_clean` | 0.15 |
| `unit_tests` | 0.15 |
| `build` | 0.10 |
| `e2e` | 0.20 |

Regression blocks completion when actionable dead-code, `clone_groups`, or `health_score` regresses vs immutable baselines.

## Exit codes (remediator-gate / debt-sweep-gate / satisfaction-loop-gate)

| Code | Meaning | Agent action |
|------|---------|--------------|
| `0` | Promote / debt sweep complete | Continue pipeline |
| `1` | Blocked (max rounds / infra) | Report with handoff |
| `3` | Remediate / continue loop | **Fix inline or advance iteration — never stop, never report** |

## Persistence

`.cursor/aaac/state/campaigns/{campaign_id}/` — see orchestrator SKILL for layout.

Full verify logs: `iterations/{n}/verify-logs/*.log` (not stderr tails).

## Fallow false positives (SSOT)

Fallow raw counts include issues that are not real debt. The loop bridges swarm knowledge into metrics via **check-app + check-architecture mirrors** (7-agent swarm).

### check_swarm flow

```bash
# After fallow-scan + classify
node .cursor/aaac/scripts/remediation/prepare-check-context.mjs \
  --campaign-id <id> --iteration <n> --run-id <run_id>

# 7 parallel readonly Task agents (see skills/shared/remediation/check-swarm/SKILL.md)
# Parent collects JSON → iterations/{n}/check-swarm-raw.json

node .cursor/aaac/scripts/remediation/merge-check-swarm.mjs \
  --campaign-id <id> --iteration <n> --run-id <run_id>
```

| Agent wave | Mirrors | Purpose |
|------------|---------|---------|
| check-app (×3) | `/check-app` | Workers, barrels, lazy routes, trace-file |
| check-architecture (×3) | `/check-architecture` | Boundaries, blast radius, dupes families |
| check-risk (×1) | remediation guard | FP registry, protected paths |

```bash
# Auto-runs after every fallow-scan
node .cursor/aaac/scripts/remediation/classify-fallow-issues.mjs \
  --campaign-id <id> --iteration <n>

# check-risk swarm records confirmed false positives
node .cursor/aaac/scripts/remediation/record-fallow-fp.mjs \
  --campaign-id <id> --path src/hooks/useCryptoPriceWorker.ts \
  --classification false_positive --reason dynamically_loaded_worker --source check-risk
```

| File | Purpose |
|------|---------|
| `fallow-fp-rules.json` | Rule SSOT (workers, overlay barrels, barrel heuristics) |
| `fallow-false-positives.json` | Campaign registry (swarm + manual overrides) |
| `iterations/{n}/fallow-classification.json` | Per-scan classified inventory |
| `iterations/{n}/check-context.json` | Swarm input SSOT (Fallow inventory + dupes top groups) |
| `iterations/{n}/check-swarm-merge.json` | Merged FP/protected paths + reclassified totals |
| `artifacts/check_app_validate.yaml` | check-app mirror verdict |
| `artifacts/check_architecture_fitness.yaml` | check-architecture mirror criteria |
| `artifacts/protected_paths.yaml` | Wave exclusion list (mandatory in dispatch-queue) |

**Satisfaction** uses `actionable_total` for dead-code (excludes `false_positive`), `clone_groups` for dupes, and `health_score` for health. Waves must not delete paths in `fallow-false-positives.json`.

## Autonomous platform (runner + babysit)

Long campaigns (`satisfaction_threshold=100`, many iterations) must use the **shell runner**, not chat turns alone.

| Layer | Path |
|-------|------|
| Shell runner | `.cursor/aaac/scripts/remediation/remediation-runner.mjs` |
| Daemon | `.cursor/aaac/scripts/remediation/remediation-runner-daemon.sh` |
| Health | `.cursor/aaac/scripts/remediation/runner-health-check.mjs` |
| Babysit skill | [skills/shared/remediation/babysit/SKILL.md](../skills/shared/remediation/babysit/SKILL.md) |

```bash
# Bootstrap (after /remediate-app creates Run + campaign)
node .cursor/aaac/scripts/remediation/remediation-runner.mjs \
  --run-id <run_id> --campaign-id <campaign_id> --until-yield

# Babysit: handle exit 3 yields, then --ack-yield <type>, repeat until exit 0
```

Stop-hook `loop_limit` (200) is a **guardrail** for short chat continuations — not the primary loop driver.

**Autonomous is baked into `init-campaign.mjs`:** when `campaign.config.autonomous`, the orchestrator reads `artifacts/autonomous_bootstrap.json` and follows [babysit/SKILL.md](../skills/shared/remediation/babysit/SKILL.md) — no extra user prompt required.
