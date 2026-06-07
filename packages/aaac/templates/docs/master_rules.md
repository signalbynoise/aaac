# Master Rules — {{PROJECT_NAME}}

This document defines **non-negotiable architectural and implementation rules** for this codebase.  
All decisions, implementations, and refactors must comply. If something conflicts, **the rules win**.

> **Project-specific paths, SSOT anchors, and tooling:** [project_context.md](./project_context.md)  
> **UI and CSS best practices:** [ui_design.md](./ui_design.md)  
> Generic rules work without edits. Fill in project context when your layout stabilizes.

---

## 1. Single Source of Truth (SSOT)

- Every piece of information may exist in **one and only one place**.
- There must never be duplicate representations of the same state, configuration, or data.
- Derived data must be **derived**, never stored.
- If two places need the same information, one owns it and the other consumes it.

**Anti-patterns:**

- Duplicated state in local component state and global store
- Copying server data into multiple stores
- Repeating constants across files
- Defining the same token in both a global theme file and a component file
- Caching a value that should be computed from an authoritative source

**Rule:**

> There can only ever be one truth.

---

## 2. Strong Separation of Concerns

Each layer has exactly one responsibility.

### UI Layer

- Responsible only for rendering and user interaction
- No business logic
- No data fetching (delegate to state or server boundaries)
- No state orchestration
- No side effects

### State Layer

- Owns application state and transitions
- No UI knowledge
- No rendering logic

### Domain / Logic Layer

- Owns business rules and invariants
- Stateless where possible
- Deterministic and testable

### Infrastructure Layer

- APIs, persistence, adapters, integrations
- No business decisions beyond boundary validation

**Rule:**

> If a file does more than one thing, it is doing too much.

---

## 3. Modular Design

- Every module must be self-contained, predictable, and replaceable.
- Modules communicate only through explicit interfaces.
- No hidden coupling through imports, globals, or side effects.

**Good modules:**

- Can be moved without breaking unrelated code
- Have clear inputs and outputs
- Do not reach into other modules' internals

**Monorepo boundaries (when applicable):**

- Shared libraries must not import from application entrypoints
- Shared types/utilities must not import framework-specific rendering code
- Applications consume shared packages; they do not reimplement primitives

---

## 4. No Hardcoding

- No hardcoded values, IDs, strings, sizes, layout numbers, URLs, or feature flags.
- All values must come from configuration, env, constants, schemas, or state.

**Rule:**

> If a value might ever change, it must not be hardcoded.

---

## 5. No Inline Styling

- No inline styles or style objects in components.
- Styling must be class-based and live in CSS files (or framework-equivalent scoped styles).
- Use custom properties and shared tokens only where values **repeat** — not as premature architecture.

**Reason:**

- Inline styles bypass maintainability and consistency
- Inline styles are hard to override and test
- Style objects couple rendering to presentation

**Full guidance:** [ui_design.md](./ui_design.md)

---

## 6. No Inline Components

- No component definitions inside other components
- No anonymous JSX logic blocks acting as components

**Why:**

- Causes unnecessary re-renders
- Breaks memoization
- Makes debugging harder
- Hides responsibilities

**Rule:**

> Every component must live in its own file and have a name.

---

## 7. Reusable by Default

- Components and modules must be reusable unless explicitly proven otherwise.
- Accept data via props or explicit inputs; avoid hidden context assumptions.
- Document intentional exceptions.

---

## 8. Logical Direction of Flow

Data and control flow must always be **unidirectional**.

### Flow direction:

- Input → State → Logic → Output
- User Action → Event → State Transition → Render

**Forbidden:**

- Circular dependencies
- UI mutating state indirectly
- Side effects triggered during render

**Rule:**

> Nothing should ever feel "magical".

---

## 9. Explicit State Machines

- All complex state must be modeled explicitly (auth, forms, uploads, checkout, sync).
- States must be finite and named.
- Transitions must be explicit and deterministic.

**State machines must define:**

- Valid states
- Valid transitions
- Invalid transitions (and how they are prevented)

**Benefits:**

- Prevents impossible states
- Prevents race conditions
- Makes logic debuggable

---

## 10. Race Condition Avoidance

- All async logic must be cancellable, idempotent where possible, and scoped to lifecycle.
- Never assume execution order or rely on timing.

**Rules:**

- No shared mutable async state
- No overlapping requests without coordination (dedupe, abort controllers, request IDs)
- No effects that depend on stale closures

---

## 11. Render Discipline

- Avoid unnecessary re-renders.
- Components render only when their inputs change.
- Memoization is a tool, not a crutch.

**Rules:**

- Stable references for props and callbacks where it matters
- No derived data inside render if it can be computed earlier
- No side effects in render

---

## 12. Predictable State Ownership

- Each piece of state has exactly one owner.
- Ownership hierarchy must be obvious.
- Passing state downward is preferred; pulling state upward is deliberate.

**Never:**

- Mutate state outside its owner
- Mirror state across layers without a documented sync contract

---

## 13. Validation at Boundaries

- Validate data at every system boundary: HTTP, RPC, forms, webhooks, queue messages, DB reads.
- Never trust user input, API responses, or external systems.

**Schemas must:**

- Be centralized and reusable
- Define invariants clearly
- Fail fast with actionable errors

---

## 14. No Hidden Side Effects

- Side effects must be explicit, isolated, and predictable.
- No side effects during render.
- No side effects hidden inside utility functions.

**Examples of explicit side effects:**

- Database writes
- Cache invalidation
- Outbound HTTP calls
- File uploads
- Analytics events

---

## 15. Determinism Over Convenience

- The same input must always produce the same output.
- Avoid randomness unless explicitly required and seeded for tests.
- Avoid time-based logic unless explicitly modeled.

**Public and cached surfaces** must remain deterministic for the same inputs and configuration.

---

## 16. Explicit Errors, Never Silent Failures

- Errors must be visible, traceable, and actionable.
- Never swallow errors or fail silently.
- Log before using documented fallbacks.

**User-facing errors** must be safe — no stack traces, secrets, or internal IDs in client responses.

---

## 17. Naming Is Architecture

- Names must describe intent, not implementation.
- Avoid vague names and non-obvious abbreviations.

Bad names hide bugs. Good names prevent them.

---

## 18. Scalability Is a First-Class Concern

- Design for growth, change, and replacement.
- Avoid cleverness.
- Favor clarity over brevity.

---

## 19. Module Size Budgets

Rules 2 and 18 are qualitative. This rule makes them **measurable**.

### Hard limits (new code must comply)

| Unit | Max lines | Max cognitive complexity (per function) |
|------|-----------|----------------------------------------|
| UI component / hook file | 250 | 15 |
| Route / page file | 200 | — (handlers delegate) |
| API handler / server action module | 250 | 20 |
| Domain / lib module | 300 | 20 |
| UI package component + styles pair | 250 | 15 |

**Per-function:** no exported function or component body over **80 lines**. Nested callbacks over **40 lines** must be named and extracted.

### Soft limits (split before adding)

If a file is **at or above 80% of its budget**, extract before appending the next feature.

Examples:

- Route at 180 lines → move logic to domain module; keep route as thin adapter
- Modal at 200 lines → extract steps into named subcomponents or hooks
- Domain module at 280 lines → split by bounded context or capability

### Layer-specific caps

See [project_context.md](./project_context.md) for path-specific caps when your layout is documented.

### When limits may be exceeded

Document why, alternatives considered, and planned follow-up (Rule 34).

### Enforcement

Run your project's size-budget tooling after implementation when configured (see project context).

---

## 20. Debug Logging

- All modules must include structured debug logging.
- Logs must be leveled, contextual, conditional, and non-breaking.
- Never log sensitive data (tokens, passwords, PII, session IDs, API keys).

**Rules:**

- Every async operation logs start, success, and failure
- Every state transition must be loggable at `debug` level
- Every error path logs full context before propagating
- Use one logging utility — no scattered `console.log` in production code

**Format:**

```
[level] [module:operation] message { context }
```

Use the logger documented in [project_context.md](./project_context.md) when configured.

**Anti-patterns:**

- Bare `console.log` with no context
- Logging inside tight loops without throttling
- Swallowing errors without logging

---

## 21. Testing

Every feature needs appropriate coverage across three levels.

### Unit Tests

- Fast (< 50ms per test where possible), deterministic, focused on one behavior
- Mock external dependencies at module boundaries
- Cover happy path, edge cases, and error cases

### Integration Tests

- Verify data flows between layers and API contracts
- Honor real state machines and adapters with fakes at the edge

### End-to-End Tests

- Cover critical user journeys and error recovery
- Stable, independent, repeatable — no timing hacks

**Rules:**

- No feature is complete without tests at the appropriate level
- Tests must run in CI on every PR
- Test names describe behavior, not implementation
- Tests must fail for the right reason — never pass by accident

**Anti-patterns:**

- Testing implementation details instead of behavior
- Snapshot tests as a substitute for assertions
- Tests coupled via shared mutable state

---

## 22. API First

Define contracts **before** implementation.

**Rules:**

- Request and response shapes are specified in a shared contract layer (OpenAPI, JSON Schema, Zod, protobuf, GraphQL schema — pick one per surface and stick to it)
- Server and client both consume the same contract — no duplicate DTO definitions
- Breaking API changes require explicit versioning or migration (Rule 33)
- Document error shapes, pagination, and idempotency keys in the contract

**Anti-patterns:**

- Implementing handlers first and documenting later
- Returning ad-hoc JSON without a schema
- Leaking internal domain models through public APIs

---

## 23. Backend for Frontend (BFF)

The client must not orchestrate multiple backend calls when a single user intent exists.

**Rules:**

- Aggregate and shape data for a specific client at a BFF or API boundary — not in UI components
- UI receives view models ready to render; it does not stitch microservice responses
- Auth, rate limits, and sensitive operations stay server-side
- BFF endpoints are thin: validate → call domain → map to contract → return

**When to use:**

- Dashboards combining multiple sources
- Mobile or web clients needing different field shapes
- Hiding internal service topology from the client

---

## 24. Security by Design

Security is not a final pass — it is a property of every change.

**Rules:**

- Validate and sanitize all input at boundaries (Rule 13)
- Principle of least privilege for DB roles, API keys, and service accounts
- Deny by default — explicit allow lists for CORS, webhooks, admin routes
- Keep dependencies updated; pin and audit supply chain (Rule 32)
- Never commit secrets; use env or secret managers (Rule 26)

**Anti-patterns:**

- Security through obscurity
- Trusting client-side validation alone
- Broad CORS or open admin endpoints without auth

---

## 25. Authentication and Authorization

AuthN and AuthZ are separate concerns with explicit enforcement points.

**Authentication (who):**

- Sessions or tokens validated on every protected request
- Expiry, refresh, and logout are explicit state machines (Rule 9)

**Authorization (what):**

- Checked at the boundary closest to the resource — not only in UI
- Role and permission rules live in domain or policy modules — not scattered in handlers
- Row-level and resource-level rules enforced in persistence layer where applicable

**Never:**

- Rely on hiding buttons as the only access control
- Pass trust from client claims without server verification

---

## 26. Secrets and Credentials

- Secrets never live in source control, logs, client bundles, or error messages.
- Load from environment, secret manager, or platform injection.
- Rotate credentials on compromise or role change.
- Use scoped keys (read-only, per-environment) — not one god key.

Document secret names (not values) in [project_context.md](./project_context.md).

---

## 27. Storage and Persistence

Data ownership and access patterns must be explicit.

**Rules:**

- One persistence adapter per external store — no raw driver calls scattered in UI
- Migrations are versioned, reversible where possible, and applied through a single pipeline
- Transactions wrap multi-step writes that must succeed or fail together
- Indexes and constraints match query patterns — document breaking schema changes
- Binary and large objects use object storage; metadata stays in the primary database

**Anti-patterns:**

- Business logic embedded in SQL strings in UI layers
- Storing derived aggregates that should be computed
- Silent schema drift between environments

---

## 28. Caching Strategy

Cache only with a defined purpose, owner, and TTL.

**Rules:**

- Every cache entry has: key schema, TTL, owner module, and invalidation trigger (Rule 29)
- Prefer edge/CDN caching for public immutable assets
- Application caches sit at infrastructure boundaries — not inside UI components
- Cache keys include all dimensions that affect correctness (user, locale, version, feature flag)
- Document stale-while-revalidate and background refresh behavior when used

**Anti-patterns:**

- Caching without TTL
- Caching user-specific data in shared keys
- Treating cache as a second source of truth

---

## 29. Cache Invalidation

> There are only two hard things in Computer Science: cache invalidation and naming things.

**Rules:**

- Every write path declares what caches it invalidates — explicitly, not by hope
- Prefer event-driven or tag-based invalidation over time-only expiry for mutable data
- On delete or permission change, invalidate all derived views (lists, counts, search indexes)
- After deploy, version cache keys or run invalidation when schema or contract changes
- Test invalidation paths — stale data bugs are production bugs

**Patterns:**

- Write → invalidate tags → next read repopulates
- Mutation response returns enough for client cache update (when using client caches)
- CDN purge only when truly public and shared

---

## 30. Idempotency and Safe Retries

Operations that can be retried must be safe to retry.

**Rules:**

- Use idempotency keys for payments, creates, and external webhooks
- POST that creates resources should detect duplicate keys and return the original result
- Queue consumers must handle at-least-once delivery without double side effects
- Timeouts and retries use bounded backoff — no infinite retry storms

---

## 31. Observability

You cannot operate what you cannot see.

**Rules:**

- Structured logs (Rule 20) plus metrics and traces for critical paths
- Correlation IDs propagate across BFF → domain → external calls
- Alert on user-impacting failures — not only process crashes
- Health checks distinguish **alive** vs **ready** (dependencies up)

Document dashboards and alert channels in project context when configured.

---

## 32. Dependencies and Supply Chain

- Pin dependency versions in lockfiles — reproducible builds only.
- Audit for known vulnerabilities before release.
- Prefer well-maintained libraries; justify new dependencies in PR description.
- No copy-paste of large third-party code without license and update path.

---

## 33. Backward Compatibility and Versioning

**Rules:**

- Public APIs version explicitly (`/v1/`, header, or package semver) — never break silently
- Database migrations must not break running code during rolling deploys when possible
- Feature flags gate risky rollouts (Rule 35)
- Deprecate with timeline and migration guide — then remove

---

## 34. No Exceptions Without Documentation

If a rule must be broken:

- Document why
- Document alternatives considered
- Document why this is safe

No undocumented exceptions.

---

## 35. Feature Flags and Gradual Rollout

- Flags control exposure — not long-term architecture.
- Flag checks live in one place; default off in production until verified.
- Remove stale flags — treat them as debt with owners and expiry.
- Never use flags to bypass security or auth checks permanently.

---

## 36. Performance and Resource Bounds

- Set budgets: response time, payload size, connection pools, memory per worker.
- Paginate list endpoints — no unbounded queries.
- Stream or chunk large downloads/uploads.
- Profile before optimizing; measure after.
- N+1 queries are defects — batch or join at the adapter.

---

## 37. Accessibility

- Semantic HTML and keyboard navigation for interactive UI.
- Labels, roles, and focus management for forms and dialogs.
- Color contrast and motion respect user preferences.
- Accessibility is not optional for user-facing features.

---

## 38. Internationalization and Localization

When supporting multiple locales:

- User-visible strings live in a translation layer — not hardcoded in components (Rule 4)
- Dates, numbers, and currency use locale-aware formatting
- RTL and plural rules are tested
- Locale is part of cache keys where content differs (Rule 28)

---

## 39. Privacy and Data Minimization

- Collect only data you need; document retention and deletion.
- Honor export and erasure requests when applicable.
- PII is classified — stricter access, encryption at rest/transit, no logging (Rule 20, 26).
- Anonymize or aggregate analytics where possible.

---

## 41. UI Design and CSS Discipline

UI styling follows senior frontend practice — not backend-style abstraction.

**Rules:**

- Normal CSS first; shallow selectors; component owns its own styles
- No deep nesting, specificity wars, or `!important` as default tools
- Use flex, grid, and container queries before JS-driven layout
- Cascade layers, custom properties, and `:where()` when they **reduce** code — see [ui_design.md](./ui_design.md)
- Do not invent token systems, variant trees, or wrapper layers until reuse proves you need them

**Before writing CSS, ask:**

1. Can this be one class?
2. Can layout be flex, grid, or a container query?
3. Can I avoid IDs, deep selectors, `!important`, and JS?
4. Are these tokens actually reused?

> The best CSS is often boring, local, shallow, and easy to delete.

**Accessibility:** semantic HTML and focus styles (Rule 37). **Tokens SSOT:** [project_context.md](./project_context.md).

---

## 42. The Prime Directive

> **Clarity beats cleverness.  
> Predictability beats shortcuts.  
> One truth beats convenience.**

If something feels confusing, it is wrong.
