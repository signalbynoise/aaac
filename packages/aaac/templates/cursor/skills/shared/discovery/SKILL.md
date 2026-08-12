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

## Retrieve-then-verify / graph-native finding (mandatory — span-first)

Every discovery Task **must**:

1. Consume the **inlined repo vector graph packet** in the prompt (and `artifacts/phase_context.json` if needed) — `read_pack`, `focus_spans`, `focus_paths`
2. **Finding is graph-native** — never Glob or repo-wide Grep/SemanticSearch to discover paths
3. **Reading is filesystem-native** — Read known paths; progressive: `envelope_text` → symbol range → full file
4. Honor hard budgets in `experience.repo_memory.meta.read_budgets`
5. Use `focus_paths` when spans are empty; honor `avoid_paths`
6. **Verify** listed spans/paths/invariants (`hash_ok` / exists). Emit `confirmed` / `stale` / `new_findings`
7. Treat `impact`, `entry_flows`, `clusters`, and `call_neighbors` as verified structure — do **not** re-walk them
8. If the graph misses what you need: emit **`retrieval_miss` / low_confidence** (`sought`, `reason`) — do **not** silently Grep/Glob; the index expands, repairs, or deliberately authorizes fallback
9. Prefer `scratchpad_excerpt` and invariants over rediscovering architecture from zero

Do **not** cold-walk the whole repo when `repo_memory.nodes`, `focus_spans`, or `read_pack` is non-empty.

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
