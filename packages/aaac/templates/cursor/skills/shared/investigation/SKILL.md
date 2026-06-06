---
name: shared-investigation
description: >-
  Deep fix investigation swarm — mandatory parallel subagents for fix paths.
  Incident subset for review-incident. Not user-facing.
disable-model-invocation: true
---

# Shared investigation (deep)

**When:** fix verb lifecycle, `fix_mode` domain orchestrators, optional deep path on `review-incident`.

For create/update use [investigation-lite](../investigation-lite/SKILL.md) instead.

**Default: readonly.** Artifacts stored on Run under `artifacts.investigation`.

Contract: [investigation.yaml](../../../aaac/contracts/skills/investigation.yaml)

## Frame (parent — before swarm)

```yaml
issue: one line
symptoms: user-visible
expected: if known
scope: files/features/routes
questions: 3–5 open questions
domain: cms | ui | database | aaac | unknown
```

Create Run artifact stub at `state/runs/{run_id}/artifacts/investigation-frame.yaml`.

---

## Mode A — Fix path (mandatory)

**Applies to:** `fix`, `fix_mode`, `/fix-module`, `/fix-bug`, resolver paths `*-fix-bug`, generic `verb-fix`.

### Phase 0 — Discovery swarm (prerequisite)

Run [discovery](../discovery/SKILL.md) first — **4–6 parallel** agents in one message. Do not start fix swarm until discovery brief exists on Run.

### Phase 1 — Fix investigation swarm (mandatory)

Launch **7 parallel** `Task` subagents in **one message**. `readonly: true` unless agent spec allows test runs.

| # | Agent spec | `subagent_type` | Angle |
|---|------------|-----------------|-------|
| 1 | [fix-repro.md](../../../agents/fix-repro.md) | `explore` | Repro steps + confirmation |
| 2 | [fix-code-path.md](../../../agents/fix-code-path.md) | `explore` | Execution trace + suspects |
| 3 | [fix-recent-changes.md](../../../agents/fix-recent-changes.md) | `shell` | Git log/blame on suspect paths |
| 4 | [fix-test-failures.md](../../../agents/fix-test-failures.md) | `shell` | Tests + failures + gaps |
| 5 | [fix-regression-scope.md](../../../agents/fix-regression-scope.md) | `explore` | Blast radius + dependents |
| 6 | [fix-runtime-evidence.md](../../../agents/fix-runtime-evidence.md) | `generalPurpose` | CI/logs/MCP evidence |
| 7 | [fix-inventory-confirm.md](../../../agents/fix-inventory-confirm.md) | `explore` | Inventory scope + constraints |

**Parent prompt must include:** intent, domain, inventory path, discovery brief summary, frame fields.

**Anti-patterns (hard fail):**

- Skipping swarm because "issue looks simple"
- Launching agents sequentially
- Planning or executing before swarm merge
- Fewer than 7 agents without documented gap + second wave

**Second wave (optional, max 2):** when any agent returns `confidence: low` — target the gap only.

### Parent merge (mandatory)

Write `state/runs/{run_id}/artifacts/investigation.md`:

```yaml
repro_steps: [numbered]
repro_confirmed: yes | partial | no
suspect_files: [path:line]
candidate_commits: [{ hash, likelihood, summary }]
test_failures: []
coverage_gaps: []
blast_radius: low | medium | high
runtime_evidence: [bullets]
constraints: [from inventory]
findings: [merged bullets]
risks: [bullets]
recommendations: [bullets]
confidence:
  architecture: 0.0–1.0
  requirements: 0.0–1.0
  scope: 0.0–1.0
```

Pass to [validation](../validation/SKILL.md) and [root-cause](../root-cause/SKILL.md).

---

## Mode B — Incident path (review-incident)

**Applies to:** `/review-incident`, `swarm-check` alias — investigation only unless `--fix`.

Launch **4 parallel** `Task` subagents in one message:

| Agent | Spec |
|-------|------|
| Repro | [fix-repro.md](../../../agents/fix-repro.md) |
| Code path | [fix-code-path.md](../../../agents/fix-code-path.md) |
| Runtime | [fix-runtime-evidence.md](../../../agents/fix-runtime-evidence.md) |
| Recent changes | [fix-recent-changes.md](../../../agents/fix-recent-changes.md) |

Layman report via [reporting](../reporting/SKILL.md) — &lt;250 words unless user asked for detail.

If intent includes `--fix` or explicit fix request → continue full **Mode A** swarm + fix lifecycle after report approval.

---

## Next phase (fix only)

Hand off to [root-cause](../root-cause/SKILL.md) before planning. Do not skip even when root cause seems obvious.

## Fix path execution

After full lifecycle gates pass, orchestrator invokes `execution` + [testing](../testing/SKILL.md) (fix verify swarm) + [verification](../verification/SKILL.md).
