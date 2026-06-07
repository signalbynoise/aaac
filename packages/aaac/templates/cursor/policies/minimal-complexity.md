# Policy: Minimal complexity

**SSOT:** [.cursor/aaac/complexity.yaml](../aaac/complexity.yaml)

**Applies to:** `create`, `update`, `fix` commands (and domain orchestrators in those modes).

**Loaded with:** master-rules, implementation, mcp-and-deploy — before plan phase on mutating verbs.

## Optimization target

```text
User request
  → Simplest solution that satisfies all stated requirements
  → NOT the most elegant or future-proof architecture
```

Optimize **capability / complexity**, not capability alone.

## Strategy priority (mandatory)

Before proposing new artifacts, search and document in the plan:

```text
1. Reuse existing function / component / module
2. Extend existing (minimal additive change)
3. Modify existing in place
4. Create new — only when 1–3 cannot satisfy a stated requirement
```

**Default verb bias:** prefer `update` over `create` when intent is ambiguous.

## YAGNI

Future requirements **do not exist** unless the user explicitly stated them.

Reject plan items justified only by:

- maybe later / might need
- future-proofing / scalability / extensibility
- generic framework / plugin system / event bus “for flexibility”

If the user did state a future requirement, cite their exact words in `requirement_map`.

## Complexity score

Sum weights from [complexity.yaml](../aaac/complexity.yaml) for each **net-new** artifact in the plan.

| Verb | Max score (block above) |
|------|-------------------------|
| fix | 5 |
| update | 8 |
| create | 12 |

Lower score wins when comparing alternatives. Document rejected higher-score options in `rejected_alternatives`.

## Plan artifact (required)

Before `validate` gate on create/update/fix, write to Run `artifacts.plan`:

```yaml
requirement_map:
  - requirement: "User can export CSV"
    satisfies_with: ["ExportButton", "GET /api/export"]
complexity_score: 2
complexity_breakdown:
  new_component: 0
  new_api_endpoint: 1
  modify: 1
reuse:
  - "ExportButton pattern from <design-system-package>"
modify:
  - "<app>/api/export/route.ts (extend existing export handler)"
create:
  - artifact: "GET /api/export/csv"
    kind: new_api_endpoint
    requirement_ref: "User can export CSV"
    why_not_reuse: "No existing CSV export route"
rejected_alternatives:
  - option: "Event bus + background queue + retry framework"
    complexity_score: 14
    rejected_because: "No requirement for async or retries"
```

## Gate enforcement

| Gate | Check |
|------|-------|
| **validate** | Plan fields present; no unjustified create; YAGNI |
| **fitness_functions** | `minimal_complexity` pass; score ≤ threshold |

On fail → Run `blocked`, `awaiting_approval: true` — same as other gates.

## Fix verb

Fix plans must be **minimal correct change** — smallest diff that resolves root cause. Prefer modify over create. Score threshold is strictest (5).

## Pruning mindset

On create/update, ask: **what existing code can this replace or extend?**

Deletion and simplification are in scope for `update`/`fix` when they reduce complexity without breaking requirements.
