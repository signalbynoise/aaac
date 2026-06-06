---
name: implementation
description: Enforces Lüdecker master rules, architecture patterns, and design system when implementing, editing, or refactoring code. Use for any code change — new features, bug fixes, UI work, API routes, migrations, or refactors. Read docs/master_rules.md, docs/architecture.md, and packages/ui tokens before writing code.
---

# Implementation

All code changes in this repo must comply with three authoritative documents. **If implementation conflicts with these docs, the docs win.**

| Document | Path | Governs |
|----------|------|---------|
| Master Rules | [docs/master_rules.md](../../../../docs/master_rules.md) | Architecture, layers, SSOT, async, testing, logging |
| Architecture | [docs/architecture.md](../../../../docs/architecture.md) | System shape, routing, state, API, DB, integrations |
| Design System | [packages/ui/src/tokens.css](../../../../packages/ui/src/tokens.css), [skills/ludecker/design-system/SKILL.md](../../../ludecker/design-system/SKILL.md) | Tokens, base components, typography |

Read the relevant sections **before** implementing. Use this skill as the workflow and checklist; use the docs as the full specification.

---

## Why God Files Still Happen

The skill enforces **layer placement** (UI vs store vs routes) but historically did **not** enforce **size budgets** or **split-before-add**. Combined with "minimal diff" in File Conventions, agents default to **appending** to existing files — which complies with layer rules while violating Rule 2 ("if a file does more than one thing, it is doing too much").

**Fix:** treat size budgets as hard gates (Master Rules §19). When a touched file is near its limit, extraction is **part of the task**, not a follow-up refactor.

---

## Before You Write Code

1. **Identify the layer** you are touching (UI, state, domain, infrastructure, server route).
2. **Read** the matching sections in the three docs above — do not rely on memory.
3. **Find existing patterns** in the same layer (grep/read neighbors; match conventions).
4. **Plan the SSOT** — where does this data live? Who owns this state? What schema validates it?
5. **Check file budgets** — run `wc -l` on files you will edit. If any file is ≥80% of its budget (see [Size Budgets](#size-budgets)), plan extraction **before** adding code.
6. **If an AAAC domain exists** for this area (`.cursor/domains/<slug>/update/inventory/`), read it for inventory, boundaries, and invariants before planning.
7. **If editing a legacy god file** (>300 lines or Fallow flagged), read [.cursor/skills/shared/architecture/refactor-analysis.md](../architecture/refactor-analysis.md) and split as part of this change unless the user scoped a hotfix only.

---

## Layer Placement (Architecture)

| Change type | Location | Must NOT |
|-------------|----------|----------|
| UI rendering | `src/app/components/` | Fetch, business logic, state orchestration |
| Global state | `src/app/store/slices/` | UI knowledge, rendering |
| Business rules | `src/app/domain/` or `shared/domain/` | React, HTTP, DB |
| Client HTTP | `src/app/api/` (domain modules) | Business decisions |
| Server routes | `server/routes/` | Business logic beyond validation + orchestration |
| Server workflows | `server/lib/` or `server/services/` | Express req/res, route registration |
| Shared validation | `shared/schemas/` | Layer-specific logic |
| Marketing site UI | `src/site/components/` | Dashboard app patterns |
| OpenRouter / LLM | `server/openrouter/` | Supabase, auth, DB (see [openrouter.md](../../../../docs/openrouter.md)) |

**URL is SSOT for navigation.** Path construction lives in `src/app/domain/paths.ts`. Store reflects URL; it does not own it.

**Data loading state machine:** `idle → loading → ready | error`. Derived data via `useMemo`, never stored separately.

---

## Size Budgets

Authoritative limits: [docs/master_rules.md §19](../../../../docs/master_rules.md#19-module-size-budgets). Architecture patterns: [docs/architecture.md § Module Composition](../../../../docs/architecture.md#module-composition-size-budgets).

| File kind | Max lines | When adding code |
|-----------|-----------|------------------|
| React component / hook | 250 | Extract subcomponents + `use<Feature>*.ts` hooks |
| Route file | 200 | Move logic to `server/lib/`; keep handler ≤15 lines |
| Domain / lib | 300 | Split by capability |
| OpenRouter module | 350 | New file per AI capability |

**Split-before-add:** at ≥80% of budget, extract first. **Never** grow `ImportFromFiles`-style monoliths.

### Extend vs new file

```
Adding to existing file?
  └─ File under 80% budget AND same single responsibility → extend
  └─ File at/above 80% budget → extract module first, then wire
  └─ New capability domain (new endpoint, new import source, new AI feature) → new file always
  └─ Touching route file with inline DB/LLM logic → move logic to server/lib/ as part of this task
```

---

## Implementation Checklist

Copy and track before finishing:

```
Implementation Progress:
- [ ] Layer placement correct (UI / state / domain / infrastructure)
- [ ] SSOT identified — no duplicated state or constants
- [ ] Size budgets respected (Master Rules §19) — split before add if near limit
- [ ] Zod schema at boundaries (shared/schemas/)
- [ ] No hardcoded values (IDs, strings, sizes, flags)
- [ ] No inline styles or style objects (except --depth / --progress)
- [ ] No inline or nested components — each in its own file
- [ ] Base components: data props only, no className
- [ ] Async logic cancellable and lifecycle-scoped via explicit state machine transitions — not guards
- [ ] Complex multi-step/async coordination modeled as a state machine (not booleans + useEffect)
- [ ] Errors explicit — logged with context, never swallowed
- [ ] Structured logging on async paths (server)
- [ ] PostHog track() if user-facing action (store action or handler)
- [ ] Tests at appropriate level (unit / integration / e2e)
- [ ] Realtime vs fetch-on-action chosen correctly
- [ ] Fallow check_changed on touched files — no new budget violations
```

---

## Master Rules — Quick Reference

Non-negotiables. Full detail: [docs/master_rules.md](../../../../docs/master_rules.md).

| # | Rule | Implementation implication |
|---|------|---------------------------|
| 1 | SSOT | One owner for each piece of state/config. Derive, don't duplicate. |
| 2 | Separation of concerns | One responsibility per file/module. |
| 4 | No hardcoding | Constants, schemas, config, tokens — never inline literals. |
| 5–6 | No inline styling/components | Token classes; named components in separate files. |
| 8 | Unidirectional flow | Input → State → Logic → Output. No magic. |
| 9 | Explicit state machines | Named states and transitions for complex flows. |
| 10 | Race avoidance | Cancellable async, no overlapping uncoordinated requests. |
| 13 | Validation at boundaries | Zod on ingress and client responses. |
| 16 | Explicit errors | Visible, traceable, actionable. Log before propagate. |
| 19 | Debug logging | `[level] [module:operation] message { context }` |
| 18 | Scalability | Size budgets §19; split before add. |
| 19 | Module size budgets | Numeric limits; Fallow gate after changes. |
| 20 | Testing | Behavior tests at unit/integration/e2e as appropriate. |
| 21 | Documented exceptions | If a rule must break, document why in code. |
| 22 | Prime directive | Clarity > cleverness. Predictability > shortcuts. |

---

## No Race Guards, Fallbacks, or Quick Fixes (Hard Ban)

When async work overlaps (delete during suggest, navigation during load, overlapping API calls), **do not** paper over timing with:

- **Race guards** — `if (!stillExists) return`, “discard stale response”, `useEffect` re-firing side effects, duplicate-request Sets without a owning machine
- **Fallback branches** — silent defaults that hide invalid state instead of preventing the transition
- **Quick fixes** — reordering `await` without modeling the flow, extra booleans, or comment-only “fixes”

These patterns hide bugs and violate Rules 9–10. They are **never** acceptable, including for regressions or hotfixes.

### Required approach

1. **Name the flow** — finite states, finite events, explicit transitions (XState machine or pure `transition*` domain module + store dispatch).
2. **One owner** — the machine owns coordination; UI reads derived selectors only.
3. **Cancel by generation/token** — bump a generation when the machine emits `CANCEL_*`; in-flight work checks generation **once** at completion to dispatch `*_ABORTED` / `*_COMPLETE`, not to silently drop data.
4. **Enter blocking phases before I/O** — e.g. `REMOVE_BEGIN` synchronously before `await api.delete…` so dependent UI cannot start new work.
5. **No reactive orchestration** — do not start mutations from `useEffect` watching derived emptiness; start only from valid machine transitions or user/store actions.

**Examples in this repo:** `requirementFocusMachine` + `requirementFocus` slice (selection + suggestion + removal), `deleteEntity.machine`, `routerResolver.machine`.

```
WRONG: useEffect(() => { if (selected && questions.length === 0) suggest(); }, [...])
WRONG: if (!requirements.find(r => r.id)) { discard suggestions; return; }
RIGHT: REMOVE_BEGIN → CANCEL_SUGGESTION → API → graph cleanup → REMOVE_END
RIGHT: SYNC_SELECTION → (machine decides) RUN_SUGGESTION effect → runQuestionSuggestion(generation)
```

---

## useState vs XState (and Pure Transition Modules)

**Pragmatic rule:**

> **Use `useState` when the state can be fully understood by reading a single component.**
>
> **Use a state machine when the state represents a process, workflow, or lifecycle with multiple valid states and transitions.**

For agentic applications: **default toward state machines for orchestration and workflows**; use hooks only for local UI state.

### `useState` — local, single-component UI

State is obvious from one file; no async coordination; no cross-system coupling.

| Example | Why hooks |
|---------|-----------|
| Modal open/closed | Binary, scoped to one component |
| Selected tab | Local presentation |
| Search input | Controlled field |
| Dropdown expanded/collapsed | Ephemeral UI |
| Local form fields | Pre-submit draft in one form |

### State machine — process, workflow, lifecycle

Multiple named states; explicit transitions; async, side effects, or coordination across store/router/API/AI.

| Example | Why a machine |
|---------|----------------|
| Authentication flow | Multi-step, errors, redirects |
| Multi-step wizard / import | Ordered steps, back/next, validation gates |
| Routing resolution | URL ↔ workspace ↔ project ↔ selection |
| Data loading with retries | `idle → loading → ready \| error` |
| AI agent / suggestion workflows | In-flight work, cancel, completion |
| Requirement → Question → Answer → Summary | Cross-column coordination |
| Delete/deactivate during async work | Blocking phases, cancellation |

**Implementation forms (pick one per flow):**

1. **XState + `useMachine`** — React lifecycle integration (e.g. `routerResolver.machine`, `deleteEntity.machine`).
2. **Pure `transition*` module + store dispatch** — Zustand-owned coordination without React actor (e.g. `requirementFocusMachine` + `requirementFocus` slice).

Both are state machines. Do not substitute a pile of booleans for either form.

### Smell test

> If you're adding flags like `isLoading`, `isFetching`, `isSaving`, `isRetrying`, `hasError`, `isReady`, `hasInitialized`, `shouldRefetch` — you're probably describing a state machine already.

Replace the flags with named states and events. One owner; UI reads derived selectors.

```
WRONG: isSuggesting + isRemoving + useEffect(() => suggest(), [selected, questions.length])
RIGHT: phase: 'selected' | 'removing', suggestion: 'idle' | 'requesting' | 'complete'
```

---

## Architecture Patterns

Full detail: [docs/architecture.md](../../../../docs/architecture.md).

### Server (BFF)

- Dashboard CRUD: `createUserClient(jwt)` — RLS enforced.
- OAuth callbacks, webhooks, background jobs: `supabaseAdmin` — no user JWT.
- Validate `req.body` with Zod middleware. Parse responses with domain schemas.
- Bind to `0.0.0.0:$PORT`. Secrets via `process.env` only.

### Client (Dashboard)

- Auth: Supabase Auth → Bearer JWT on `/api/*` calls.
- Zustand slices per domain. Store actions are SSOT for API-backed mutations.
- `track()` in store actions (API flows) or component handlers (pure UI events). Never in render.
- Realtime for externally-modified data; fetch-on-action for user's own mutations.

### Schemas

`shared/schemas/` — row schema (snake_case), domain schema (camelCase), mutation schemas. Consumed by client and server.

### New API endpoint

1. Zod mutation schema in `shared/schemas/`
2. Workflow logic in `server/lib/<feature>.ts` (if >15 lines or reusable)
3. Thin route in `server/routes/` with `requireAuth` + `validateBody` — delegate to lib
4. Client method in `src/app/api/<domain>Api.ts` with response parsing
5. Store action in appropriate slice
6. UI calls store action only

If `server/routes/<resource>.ts` exceeds **200 lines**, new endpoints must not be added inline — extract handlers to `server/lib/` first (see `requirementsRouteHelpers.ts` for error-mapping pattern).

### AI / OpenRouter feature

Read [docs/openrouter.md](../../../../docs/openrouter.md) first.

1. Context loading in `server/context.ts` or `server/lib/*Context*.ts`
2. Prompt + LLM I/O in new `server/openrouter/<feature>.ts` (one capability per file)
3. Route/job calls openrouter with context as arguments
4. Schema validation on LLM output at module boundary
5. Unit tests for schemas and pure helpers — no live OpenRouter calls

### Multi-step UI (modals, import flows, wizards)

Use a **feature folder** (see architecture doc). Step flow must be an **explicit state machine** (XState or pure `transition*` module) — not ad-hoc step booleans.

1. `<Feature>.tsx` — thin shell (~100 lines max)
2. `<feature>.machine.ts` or `use<Feature>State.ts` — step machine (finite states + transitions)
3. `use<Feature>Actions.ts` — store mutations and side effects triggered by machine effects
4. One subcomponent per step/section

Do not add steps to a 300+ line modal component.

### New integration

Follow OAuth pattern in architecture doc. Store slice in `store/slices/<provider>.ts`. Connection table with RLS `user_id = auth.uid()`.

---

## Design System

Full detail: [docs/design_system.md](../../../../docs/design_system.md). Component specs: [docs/design_components.md](../../../../docs/design_components.md).

### Token SSOT

All visual values from `src/styles/theme.css` via Tailwind utilities. **No** hardcoded hex/rgba, arbitrary `rounded-[Npx]`, `font-[N]`, or `shadow-[...]`.

### Base Component Architecture (CRITICAL)

Base components (`src/app/components/ui/`) own **all** visual styling.

```
CORRECT:  <DropdownPanel variant="attached" position="above">...</DropdownPanel>
WRONG:    <DropdownPanel className="absolute bottom-full ...">...</DropdownPanel>
```

- Consumers pass **data props only** (`variant`, `label`, `icon`, `onClick`).
- Base components do **not** accept `className`. Zero exceptions.
- New visual variation → new prop on base, styled internally.
- Use typography presets (`.text-h1`, `.text-caption`, `.text-label`) — do not override with extra `font-*` / `tracking-*` / `uppercase`.

### Only permitted inline styles

`style={{ '--depth': N }}` and `style={{ '--progress': 'N%' }}` for tree indentation and progress bars.

### New UI component workflow

1. Check for existing base component or pattern.
2. If reusable visual pattern → extend or create base in `ui/`.
3. Consumer component imports base; passes props only.
4. New tokens → add to `theme.css` `:root` + `@theme inline` + document in design_system.md.

---

## Decision Trees

### Where does this logic go?

```
User clicked something?
  └─ Pure UI event (modal open, palette) → component handler + track()
  └─ Mutates app data → store action → api.ts → server route

Business rule or invariant?
  └─ src/app/domain/ or shared/domain/

Validation?
  └─ shared/schemas/ (Zod)

Visual styling?
  └─ Base component in ui/ (tokens only)

Navigation?
  └─ paths.ts + URL params → routerResolver.machine → store

Async workflow or multi-system coordination?
  └─ XState (React) or transition* module + store dispatch — never useState flags + useEffect
```

### Realtime or fetch-on-action?

```
Data changed by external system (webhook, other user, job)?
  └─ Supabase Realtime → silent store refresh

Data changed by current user's action?
  └─ Use API response / store update from action (no Realtime needed)
```

### Which Supabase client?

```
User-initiated dashboard CRUD?
  └─ createUserClient(jwt)

OAuth callback, webhook, background job?
  └─ supabaseAdmin
```

---

## File Conventions

Match existing code in the target directory:

- **Naming:** intent over implementation. No vague abbreviations.
- **Imports:** explicit interfaces between modules. No circular deps.
- **Components:** one named export per file. No render helpers inside component bodies.
- **Scope:** minimal *behavioral* diff — but **structural extraction is in scope** when size budgets require it. Do not append to god files to avoid file churn.
- **Comments:** only for non-obvious business logic.

---

## After Implementation

1. **Self-review** against the checklist above.
2. **Run Fallow on changed files** — MCP `check_changed` or `npx fallow health --changed-since HEAD --file-scores`. Fix any new budget violations before finishing.
3. **Read lints** on edited files; fix introduced issues.
4. **Run relevant tests** if they exist for the touched area.
5. **Verify layer boundaries** — no fetch in UI, no business logic in routes beyond orchestration.
6. **Verify design system** — grep edited files for hardcoded colors, `className` on base components, inline `style={{}}`.

---

## Common Violations to Avoid

| Violation | Fix |
|-----------|-----|
| Fetch in component | Move to store action or dedicated hook that delegates to store |
| Duplicated constant | Centralize in `constants.ts`, schema, or config |
| Local state mirroring server data | Store owns it; derive in render |
| `className` on `DropdownPanel`, `IconButton`, etc. | Add/use variant prop on base |
| `#10b981` or `rgba(...)` in className | Use token class (`bg-indicator-high`, etc.) |
| Nested component in parent file | Extract to own file |
| Unvalidated API body | Add Zod schema + validateBody middleware |
| `console.log` in server code | Use structured logger |
| New user action without `track()` | Add to store action or handler |
| Ad-hoc boolean flags for multi-step flow | Explicit state machine (XState or `transition*` module) |
| `isLoading` / `isSaving` / `shouldRefetch` flag pile | Named machine states + transitions |
| Race guard / stale-response discard | Machine phase + generation token + explicit abort/complete events |
| useEffect-driven auto-mutations | Store action or machine effect from a valid transition |
| Appending to file over size budget | Extract to `server/lib/`, feature folder, or new openrouter module |
| 500-line modal/import component | Feature folder + hooks + step subcomponents |
| God route file with inline DB/LLM | Thin route + `server/lib/` workflow |
| Skipping Fallow after edit | Run `check_changed`; fix new violations |

---

## Related Skills

- **AAAC commands:** [docs/agentic_architecture.md](../../../../docs/agentic_architecture.md) — `/update-module`, `/create-feature`, `/fix-bug`, etc.; sync `domains/<slug>/update/inventory` after changes
- **Refactoring analysis (required when editing files >300 lines):** [.cursor/skills/shared/architecture/refactor-analysis.md](../architecture/refactor-analysis.md) via `/review-module`
- **Code health gate:** Fallow MCP `check_changed` after every implementation when Fallow is configured
- **MDA demos (marketing site):** [.cursor/skills/mda-director/SKILL.md](../../../mda-director/SKILL.md), [.cursor/skills/mda-scriptwriter/SKILL.md](../../../mda-scriptwriter/SKILL.md)

---

## References

- [docs/master_rules.md](../../../../docs/master_rules.md)
- [docs/architecture.md](../../../../docs/architecture.md)
- [docs/design_system.md](../../../../docs/design_system.md)
- [docs/design_components.md](../../../../docs/design_components.md)
- [docs/openrouter.md](../../../../docs/openrouter.md) — LLM adapter patterns (when touching AI features)
