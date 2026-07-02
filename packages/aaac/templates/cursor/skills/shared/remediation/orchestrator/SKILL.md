---
name: remediate-app-orchestrator
description: >-
  Orchestrates /remediate-app — Fallow scan, check swarm, ranked fix waves,
  regression wave gates, mandatory debt sweep, satisfaction loop.
disable-model-invocation: true
---

# remediate-app orchestrator

Campaign loop for whole-repo health remediation. Model after [platform-release/orchestrator](../../platform-release/orchestrator/SKILL.md) wave blocking.

Fallow scan suite: **dead-code** + **dupes** + **health** (all three run every iteration via `fallow-scan.mjs`).

Contract: [contract.yaml](./contract.yaml)

## Hard invariants (never violate)

| Rule | Meaning |
|------|---------|
| **Exit 3 ≠ stop** | `remediator-gate` / `debt-sweep-gate` exit **3** means **remediate and retry**. Never set `campaign.status=blocked`, never skip remaining waves, never advance to `report`. |
| **Wave = regression** | Pre-existing typecheck/vitest debt does **not** block wave promotion. Only **new** regressions vs pre-wave snapshot trigger wave remediator. |
| **Debt sweep = strict** | After all waves, `debt_sweep` must reach **zero errors** on all layers before `satisfaction_gate` or `report`. |
| **All waves run** | Every wave in `plan_waves.yaml` must execute (status `completed`, `degraded`, or `deferred`) — never skip waves 2–3 because wave 1 handed off. |
| **Validate before report** | Run `validate-campaign-complete.mjs --require-debt-sweep --require-satisfaction-loop`; exit 1 → do not complete Run. |
| **Satisfaction exit 3 ≠ report** | `satisfaction-loop-gate` exit **3** → `--advance` to next iteration, return to `scan`. |
| **Immutable Fallow start** | `fallow-start-baseline.json` (dead-code), `fallow-start-dupes-baseline.json`, `fallow-start-health-baseline.json` written once; dupes/health auto-backfill if missing |

## Parse

| Slot | Rule |
|------|------|
| Domain | Optional — `frontend`, `backend`, or omit for `whole-repo` |
| Intent | `max_iterations`, `max_waves_per_iteration`, `max_remediator_attempts_per_wave`, `max_remediator_attempts_per_debt_round`, `max_debt_sweep_rounds`, `satisfaction_threshold`, `resume campaign_*`, `autonomous` / `manual` |

**Autonomous mode (baked in):** `init-campaign.mjs` sets `config.autonomous` when any of:

- intent contains `autonomous`
- `satisfaction_threshold >= 100`
- `max_iterations >= 10`

Override off with `manual` in intent.

When `config.autonomous === true`, **do not walk phases manually**. Read [babysit/SKILL.md](../babysit/SKILL.md) and follow `artifacts/autonomous_bootstrap.json` → `next_action` until runner exit **0**.

**Preflight:** When `remediation.verify.playwright.enabled`, ensure dev server is reachable at `project.config.json` → `remediation.verify.dev_server.url` before debt sweep / Playwright gates.

## Scripts (mandatory)

| Step | Command |
|------|---------|
| Init campaign | `node .cursor/aaac/scripts/remediation/init-campaign.mjs --run-id <run_id> --scope whole-repo --intent "<intent>"` |
| Verify baseline | `node .cursor/aaac/scripts/remediation/capture-verify-baseline.mjs --campaign-id <id> --run-id <run_id>` |
| Fallow scan | `node .cursor/aaac/scripts/remediation/fallow-scan.mjs --campaign-id <id> --iteration <n> [--save-baseline]` — runs dead-code, dupes, health |
| Classify Fallow | `node .cursor/aaac/scripts/remediation/classify-fallow-issues.mjs --campaign-id <id> --iteration <n>` (auto after scan) |
| Prepare check context | `node .cursor/aaac/scripts/remediation/prepare-check-context.mjs --campaign-id <id> --iteration <n> --run-id <run_id>` |
| Merge check swarm | `node .cursor/aaac/scripts/remediation/merge-check-swarm.mjs --campaign-id <id> --iteration <n> --run-id <run_id>` |
| Record false positive | `node .cursor/aaac/scripts/remediation/record-fallow-fp.mjs --campaign-id <id> --path <file> --classification false_positive` |
| Pre-wave snapshot | `node .cursor/aaac/scripts/remediation/capture-wave-snapshot.mjs --campaign-id <id> --iteration <n> --wave-index <w>` |
| Wave gate | `node .cursor/aaac/scripts/remediation/remediator-gate.mjs --campaign-id <id> --iteration <n> --mode wave --wave-index <w> --run-id <run_id> --attempt 1` |
| Debt sweep | `node .cursor/aaac/scripts/remediation/debt-sweep-gate.mjs --campaign-id <id> --iteration <n> --run-id <run_id> --round 1 --attempt 1` |
| Validate complete | `node .cursor/aaac/scripts/remediation/validate-campaign-complete.mjs --campaign-id <id> --iteration <n> --require-debt-sweep` |
| Satisfaction | `node .cursor/aaac/scripts/remediation/compute-satisfaction.mjs --campaign-id <id> --iteration <n>` |
| Satisfaction loop gate | `node .cursor/aaac/scripts/remediation/satisfaction-loop-gate.mjs --campaign-id <id> --iteration <n> --run-id <run_id> [--advance]` |
| Repair Fallow start | `node .cursor/aaac/scripts/remediation/repair-fallow-start-baseline.mjs --campaign-id <id> --total <n>` |
| Journal step | `node .cursor/aaac/scripts/remediation/record-iteration-step.mjs --campaign-id <id> --step <name> --detail "..." --status pass\|fail` |

## Phases

### 1. campaign_init

1. Run `init-campaign.mjs`
2. If `config.autonomous` → read `artifacts/autonomous_bootstrap.json` and **[babysit/SKILL.md](../babysit/SKILL.md)**; enter runner loop (skip manual phase walk below)
3. Run `capture-verify-baseline.mjs` (records pre-campaign error counts) — runner also does this on first tick if resuming
4. Write `artifacts/campaign.json` and `artifacts/verify_baseline.json`

**Autonomous first action after init:**

```bash
node .cursor/aaac/scripts/remediation/runner-health-check.mjs --campaign-id <id>
node .cursor/aaac/scripts/remediation/remediation-runner.mjs \
  --run-id <run_id> --campaign-id <id> --until-yield
```

Then babysit loop until exit **0**. Never end turn on exit **3**.

### 2. scan

1. Set iteration `n = campaign.iteration`
2. Run `fallow-scan.mjs --save-baseline` **only** when:
   - New campaign (`fallow-start-baseline.json` missing), or
   - Starting a **new** iteration (`n > 0` or first scan after `--advance`)
3. On **resume** of same iteration: run `fallow-scan.mjs` **without** `--save-baseline`

Readonly. No code edits.

### 3. check_swarm (parallel — **7 Task agents**, one message)

**Skill:** [check-swarm/SKILL.md](../check-swarm/SKILL.md) — mirrors `/check-app` + `/check-architecture`.

**Preflight:**

```bash
node .cursor/aaac/scripts/remediation/prepare-check-context.mjs \
  --campaign-id <id> --iteration <n> --run-id <run_id>
```

| Wave | Agent spec | Mirrors |
|------|------------|---------|
| A1 | remediation-check-app-inventory | `/check-app` inventory |
| A2 | remediation-check-app-ssot | `/check-app` SSOT |
| A3 | remediation-check-app-trace | `/check-app` trace (+ `fallow --trace-file`) |
| B1 | remediation-check-architecture-boundaries | `/check-architecture` boundaries |
| B2 | remediation-check-architecture-deps | `/check-architecture` dependencies |
| B3 | remediation-check-architecture-decomposition | `/check-architecture` dupes families |
| C1 | remediation-check-risk | FP registry guard |

**Post-merge (mandatory):**

```bash
# Parent writes iterations/{n}/check-swarm-raw.json from agent JSON blocks first
node .cursor/aaac/scripts/remediation/merge-check-swarm.mjs \
  --campaign-id <id> --iteration <n> --run-id <run_id>
```

**Parent synthesis:** `artifacts/check_synthesis.md`, `artifacts/dispatch-queue.yaml` (include `protected_paths` from merge)

Outputs: `check_app_validate.yaml`, `check_architecture_fitness.yaml`, `protected_paths.yaml`, `check_swarm_merge.json`, updates `fallow-false-positives.json`

**Fallow SSOT:** Dead-code raw counts are not remediation truth. After scan, `classify-fallow-issues.mjs` splits dead-code into `true_positive`, `review`, and `false_positive`. Satisfaction uses **actionable** dead-code, **clone_groups** (dupes), and **health_score** (health). Swarm-confirmed false positives go to `record-fallow-fp.mjs` → `fallow-false-positives.json`.

### 4. plan_waves

1. Validate dispatch queue entries
2. Truncate to `max_waves_per_iteration`
3. Write `artifacts/plan_waves.yaml`

Readonly.

### 5. execute (sequential waves only)

For **each** wave in `plan_waves.yaml`:

1. `capture-wave-snapshot.mjs --wave-index <w>` (pre-wave metrics)
2. Apply fix per wave `command` + `intent` (inline fix-* orchestrator — no nested Run)
3. **Remediator sub-loop (mandatory):**

```text
attempt ← 1
loop:
  remediator-gate --mode wave --wave-index <w> --attempt <attempt>
  if action in (promote, promote_wave, defer_to_debt_sweep) → break  # continue to NEXT wave
  if action=remediate (exit 3):
    run remediation-remediator handoff inline
    attempt ← attempt + 1
    goto loop   # NEVER stop campaign here
  if action=infrastructure → fix infra, retry
```

4. Record wave status `completed` | `degraded` | `deferred` in `artifacts/execute_waves.json`
5. **Always proceed to next wave** — never abort execute phase on exit 3

### 6. debt_sweep (mandatory strict gate)

Clears **all** remaining errors (old + new). Runs after every iteration's execute phase.

```text
round ← 1
attempt ← 1
loop:
  debt-sweep-gate --round <round> --attempt <attempt>
  if action=debt_sweep_complete → break
  if action=remediate (exit 3):
    run remediation-remediator handoff inline
    attempt ← attempt + 1
    goto loop
  if action=debt_sweep_next_round → round++, attempt←1, goto loop
  if action=debt_sweep_blocked → campaign blocked (only after max_debt_sweep_rounds)
```

Full logs: `iterations/{n}/verify-logs/debt-*.log`  
Artifacts: `artifacts/debt_sweep.json`, `verify-debt.json`

### 7. satisfaction_gate

```bash
node .cursor/aaac/scripts/remediation/compute-satisfaction.mjs --campaign-id <id> --iteration <n>

node .cursor/aaac/scripts/remediation/satisfaction-loop-gate.mjs \
  --campaign-id <id> --iteration <n> --run-id <run_id> --advance
```

| Gate exit | Action |
|-----------|--------|
| `0` + `action: complete` | Threshold met → `report` |
| `0` + `action: partial_complete` | Max iterations → `report` (partial) |
| `3` + `action: continue_loop` | **Return to `scan`** for `next_iteration` — **never report** |
| `1` | Debt/verify prerequisites missing — fix first |

**Fallow start baseline** is immutable (`fallow-start-baseline.json`). Never rescored from resume scans.

### 8. report

**Before writing report:**

```bash
node .cursor/aaac/scripts/remediation/validate-campaign-complete.mjs \
  --campaign-id <id> --iteration <n> --require-debt-sweep --require-satisfaction-loop
```

If violations → do not complete Run. `satisfaction_loop_blocks_report` means iteration 1+ was required.

## Autonomous platform

For multi-iteration campaigns, use the shell runner + babysit skill instead of relying on chat stop-hook loops.

| Component | Role |
|-----------|------|
| `remediation-runner.mjs` | Drives scriptable phases; **yields** (exit 3) for agent work |
| `remediation-runner-daemon.sh` | Background automated bursts; emits `AGENT_REMEDIATION_RUNNER` |
| `runner-health-check.mjs` | Stall, regression, yield-timeout detection |
| [babysit/SKILL.md](../babysit/SKILL.md) | Handles yields, acks, safety |

```bash
node .cursor/aaac/scripts/remediation/remediation-runner.mjs \
  --run-id <run_id> --campaign-id <id> --until-yield
# exit 3 → babysit → --ack-yield <type> → repeat
```

Runner state: `campaigns/{id}/runner-state.json`, yields: `runner-yield.json`.

## Two-tier validation

| Tier | When | Pass condition |
|------|------|----------------|
| **Regression** | After each cleanup wave | Error counts did **not increase** vs pre-wave snapshot |
| **Strict** | `debt_sweep` phase | typecheck, vitest, go test, build, Playwright all pass; `total_errors === 0` |

## Anti-patterns (forbidden)

- Treating remediator exit **3** as campaign stop
- Setting `campaign.status=blocked` on wave handoff
- Skipping waves because verify failed on pre-existing debt
- Completing Run while `debt_sweep` pending or remediator loop `running`
- Writing report when `satisfaction-loop-gate` exits **3**
- Re-scanning with `--save-baseline` on resume (overwrites immutable start baseline)
- Using stderr tails only — read `verify-logs/*.log` for full evidence
- Bulk `fallow fix --yes` without trace-file

## Persistence paths

```
.cursor/aaac/state/campaigns/{campaign_id}/
  campaign.json
  fallow-start-baseline.json
  fallow-start-dupes-baseline.json
  fallow-start-health-baseline.json
  journal.md
  iterations/{n}/
    fallow-scan.json
    fallow-dupes.json
    fallow-health.json
    fallow-scan-bundle.json
    fallow-scan-bundle.json
    fallow-classification.json
    check-context.json
    check-swarm-raw.json
    check-swarm-merge.json
    protected-paths.json
    verify-wave.json
    verify-debt.json
    verify-logs/
    debt-sweep-state.json
    remediator-loop-wave-{w}.json
```
