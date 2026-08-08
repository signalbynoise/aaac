---
name: remediate-app-babysit
description: >-
  Babysit an active /remediate-app campaign using the shell runner. Handles
  runner yields (check_swarm, execute waves, remediator handoffs, report),
  runs health checks, and loops until satisfaction or max iterations. Use when
  asked to continue remediation autonomously, babysit the campaign, or resume
  run_*/campaign_* remediation.
disable-model-invocation: true
---

# Remediation babysit (safety layer)

**Auto-invoked** when `campaign.config.autonomous === true` (set by `init-campaign.mjs`). The user does not need a separate “babysit” prompt.

Pairs with the **shell runner** (foundation). The runner drives scriptable phases; this skill handles **yields** and **safety**.

| Layer | Script / skill | Role |
|-------|----------------|------|
| Foundation | `remediation-runner.mjs` | State machine, gates, satisfaction loop |
| Daemon | `remediation-runner-daemon.sh` | Delegates to continuous yield watcher |
| Watcher | `remediation-yield-watcher.mjs` | Continuous loop until satisfaction goal |

## When to use

- Campaign `status: running` but chat stopped mid-iteration
- `runner-yield.json` exists (runner exit **3**)
- User asks to **continue**, **babysit**, or **run autonomously** to satisfaction threshold
- After `/remediate-app` with `max_iterations` > 5 or `satisfaction_threshold=100`

## When NOT to use

- Campaign `status: complete` and satisfaction gate says `complete`
- No `runner-state.json` — run `remediation-runner.mjs --tick` once to init, or start via `/remediate-app`
- User explicitly wants a single manual iteration only

## Hard rules

1. **Exit 3 ≠ stop** — runner yield, remediator gate, satisfaction gate continue = keep going
2. **Never report** while `satisfaction-loop-gate` says `continue_loop`
3. **Run health check** before each babysit cycle
4. **Ack every yield** with `--ack-yield <type>` after agent work — runner will not advance otherwise
5. **check_swarm** — exactly **7** readonly Task agents (see [check-swarm/SKILL.md](../check-swarm/SKILL.md))
6. **Test-only waves** — use `test_execute` phase for test file dedupes, or mark wave `degraded` in `execute_waves.json`



## Cursor CLI watch (preferred for monitoring)

Readable live progress in the **Cursor integrated terminal** (not a background shell task):

```bash
node .cursor/aaac/scripts/remediation/remediation-cli.mjs watch \
  --run-id <run_id> --campaign-id <campaign_id>
```

Each cycle prints a line like:
`[remediate] iter 8 | execute/wave_fix wave 1 | score 45/100 | health 88.7 → yield execute_wave`

Snapshot SSOT: `.cursor/aaac/state/campaigns/<campaign_id>/progress.json`

One-shot status:
```bash
node .cursor/aaac/scripts/remediation/remediation-cli.mjs status --campaign-id <id> --run-id <run_id>
```

Via Cursor agent CLI (agent session supervises the watch command):
```bash
node .cursor/aaac/scripts/remediation/remediation-cli.mjs cursor --run-id <run_id> --campaign-id <id>
# or: .cursor/aaac/scripts/remediation/remediation-cursor-watch.sh <run_id> <campaign_id>
```

## Continuous yield watcher (headless / CI)

Runs until `satisfaction_threshold` is met (extends `max_iterations` if needed):

```bash
node .cursor/aaac/scripts/remediation/remediation-yield-watcher.mjs \
  --run-id <run_id> --campaign-id <campaign_id>
# Monitor: ^AGENT_REMEDIATION_WATCHER
```

Each cycle: health-check → runner `--until-yield` → `handle-yield.mjs` (scriptable + Cursor agent for code waves) → `--ack-yield` → repeat.

Background via daemon:

```bash
.cursor/aaac/scripts/remediation/remediation-runner-daemon.sh <run_id> <campaign_id>
```

Focus is parsed from campaign intent (`focus: Health Functions >60 LOC`, protected paths, wave intents).

## Autonomous loop (mandatory pattern)

```text
1. health-check
2. runner --until-yield  (or daemon script)
3. if exit 0 → validate + report → done
4. if exit 3 → read runner-yield.json → do agent work → --ack-yield <type> → goto 1
5. if exit 1 → journal + user handoff (blocked)
```

### Commands

```bash
# Status
node .cursor/aaac/scripts/remediation/remediation-runner.mjs \
  --run-id <run_id> --campaign-id <campaign_id> --status

# Health (stall / regression)
node .cursor/aaac/scripts/remediation/runner-health-check.mjs \
  --campaign-id <campaign_id>

# Automated burst (stops at yield)
node .cursor/aaac/scripts/remediation/remediation-runner.mjs \
  --run-id <run_id> --campaign-id <campaign_id> --until-yield

# Background daemon with sentinel (optional)
.cursor/aaac/scripts/remediation/remediation-runner-daemon.sh \
  <run_id> <campaign_id>
# Monitor: ^AGENT_REMEDIATION_RUNNER
```

## Yield handlers

| `yield.type` | Agent work | Ack |
|--------------|------------|-----|
| `check_swarm` | 7 parallel Task agents → `iterations/{n}/check-swarm-raw.json` | `--ack-yield check_swarm` |
| `dispatch_queue` | Write `dispatch-queue.yaml` from merge synthesis | `--ack-yield dispatch_queue` |
| `execute_wave` | Inline `fix-module` / `fix-app` per wave intent; update `execute_waves.json` | `--ack-yield execute_wave` |
| `remediator` | Run handoff from `remediator-handoff-attempt-*.json` inline | `--ack-yield remediator` |
| `report` | Write `artifacts/report.md`, complete Run | `--ack-yield report` |

After each ack:

```bash
node .cursor/aaac/scripts/remediation/remediation-runner.mjs \
  --run-id <run_id> --campaign-id <campaign_id> --ack-yield <type>
```

Then immediately `--until-yield` again.

### check_swarm yield (7 agents)

Read `iterations/{n}/check-context.json`. Launch in **one message**:

- remediation-check-app-inventory
- remediation-check-app-ssot
- remediation-check-app-trace
- remediation-check-architecture-boundaries
- remediation-check-architecture-deps
- remediation-check-architecture-decomposition
- remediation-check-risk

Merge parent writes `check-swarm-raw.json`, then:

```bash
node .cursor/aaac/scripts/remediation/merge-check-swarm.mjs \
  --campaign-id <id> --iteration <n> --run-id <run_id>
```

Parent writes `dispatch-queue.yaml` + `artifacts/check_synthesis.md`, then `--ack-yield check_swarm`.

### execute_wave yield

1. Read `artifacts/plan_waves.yaml` wave `wave_index`
2. Respect `artifacts/protected_paths.yaml`
3. Apply fix inline (no nested AAAC Run)
4. Record wave in `artifacts/execute_waves.json` (`completed` | `degraded` | `deferred`)
5. `--ack-yield execute_wave` → runner runs regression gate

### remediator yield

1. Read `yield.handoff` or latest `remediator-handoff-attempt-*.json`
2. Fix inline per [remediation-remediator.md](../../../../agents/remediation-remediator.md)
3. `--ack-yield remediator` → runner retries gate with `attempt + 1`

## Safety checks (`runner-health-check.mjs`)

| Code | Meaning | Action |
|------|---------|--------|
| `stall_ticks` | Score/clones flat too long | Change wave plan or fix stuck yield |
| `yield_timeout` | Agent yield stale | Complete ack or escalate |
| `dupes_regression` | Clone groups grew >5% vs baseline | Stop deletes; re-run check_swarm |
| `health_regression` | Health dropped >2 pts | Roll back last wave |
| `flat_satisfaction` | 3 iterations same score | Prioritize dupes/health waves |

Exit **1** from health check → investigate before continuing automated runner.

## Resume paused campaign (chat died at iteration N)

```bash
# 1. Find run + campaign from campaign.json
cat .cursor/aaac/state/campaigns/<campaign_id>/campaign.json

# 2. Init runner state from manifest (if missing)
node .cursor/aaac/scripts/remediation/remediation-runner.mjs \
  --run-id <run_id> --campaign-id <campaign_id> --status

# 3. If phase=scan and iter 3 has stale artifacts from older run, re-scan:
node .cursor/aaac/scripts/remediation/fallow-scan.mjs \
  --campaign-id <id> --iteration <n>

# 4. Babysit loop
```

## Completion

Only when runner exits **0**:

```bash
node .cursor/aaac/scripts/remediation/validate-campaign-complete.mjs \
  --campaign-id <id> --iteration <n> \
  --require-debt-sweep --require-satisfaction-loop
```

Write report if `yield.type=report` not yet acked.

## Related

- [orchestrator/SKILL.md](../orchestrator/SKILL.md) — phase contracts
- [check-swarm/SKILL.md](../check-swarm/SKILL.md) — 7-agent mirror
- `/remediate-app` command — manual + runner bootstrap
