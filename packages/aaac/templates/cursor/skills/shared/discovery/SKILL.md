---
name: shared-discovery
description: >-
  Readonly discovery swarm for AAAC orchestrators. Spawns parallel subagents
  per .cursor/agents/discovery-*.md. Use only via graph — not user-facing.
disable-model-invocation: true
---

# Shared discovery

## When

Orchestrator phase `discovery_swarm`. **Readonly** — no file edits.

## Swarm (mandatory)

Read **`manifest.swarm.target_agents.discover`** (or current phase key) from the Run — do not hardcode agent counts. Floors and tiers live in `.cursor/aaac/swarm-sizing.yaml`; bootstrap scope score sets the initial target at Run start.

Launch **that many** parallel `Task` subagents (`explore`, `readonly: true`) in **one message** (split into waves when `manifest.swarm.wave_plan.discover` exists):

| Agent spec | Angle |
|------------|-------|
| [discovery-inventory.md](../../../agents/discovery-inventory.md) | Files, routes, tests |
| [discovery-boundaries.md](../../../agents/discovery-boundaries.md) | In/out of scope |
| [discovery-ssot.md](../../../agents/discovery-ssot.md) | State ownership |

Add domain-specific angles from inventory skill. Respect ceiling in swarm-sizing.yaml; second wave only when wave_plan requires it.

## Retrieve-then-verify (mandatory — V6)

Every discovery Task **must**:

1. Read **`artifacts/phase_context.json`** (path relative to the Run dir) — especially `experience.repo_memory`
2. **Progressive reading (span-first):** start from `experience.repo_memory.focus_spans` — open each `path` at `envelope_start`–`envelope_end` first; widen to the full symbol (`start`–`end`) only if needed; open the full file only for gaps
3. Use `focus_paths` / `context_hint.recommended_focus_paths` when spans are empty or insufficient
4. Honor `avoid_paths` (do not expand into skip paths unless the intent requires them)
5. **Verify** listed spans/paths and invariants against disk (`hash_ok` / file exists). Mark stale or wrong entries
6. Treat `impact`, `entry_flows`, `clusters`, and `call_neighbors` as verified structure — do **not** re-walk neighbors / dependents / entry chains / callers already listed; open files outside those sets only for gaps
7. Expand filesystem search **only for gaps** (missing coverage, stale nodes, open questions)
8. Prefer `experience.repo_memory.scratchpad_excerpt` and invariants over rediscovering architecture from zero

Do **not** cold-walk the whole repo when `repo_memory.nodes` or `focus_spans` is non-empty.

## discover_brief scope_signals (mandatory)

Each discovery agent must contribute to merged **`artifacts/discover_brief.yaml`** including a `scope_signals` block consumed by `compute-scope-complexity.mjs`:

```yaml
scope_signals:
  files_in_scope: <number>
  cross_domain: <true|false>
  migration_mentioned: <true|false>
  protected_object: <true|false>
  intent_ambiguity: low|medium|high
  open_questions: <count>
confirmed: []   # paths/invariants verified from repo_memory
stale: []       # repo_memory entries that failed verify
new_findings: []  # paths found beyond repo_memory
```

## Task prompt (mandatory)

Every Task prompt **must** include the policy excerpt from [_task-prompt-policy.md](../_task-prompt-policy.md) plus: intent, domain, inventory constraints, the linked agent spec path, and the Run **`artifacts/phase_context.json`** path.

## Output

Merged brief for `planning`: findings, evidence, gaps, confidence, plus `confirmed` / `stale` / `new_findings`. Parent spot-checks `path:line` claims.
