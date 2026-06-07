# Master rules

These rules apply to every code change in this project. Agentic OS loads them automatically — you do not need to configure anything after install.

## Core principles

1. **One source of truth** — Each fact lives in one place. Do not duplicate constants, config, or state.
2. **Clear layers** — UI renders and handles interaction. Domain logic holds business rules. Infrastructure talks to databases and APIs. Do not mix these roles in one file.
3. **Predictable flow** — Data moves in one direction: input → logic → output. No hidden side effects.
4. **Explicit errors** — Log and surface failures. Do not fail silently.
5. **Clarity over cleverness** — Prefer readable code over shortcuts.

## Implementation

- Pull values from config, env, or constants — not unexplained literals in components.
- Use shared styles or design tokens — not inline styles in UI code.
- One named component per file.
- Async work should be cancellable where possible and logged at boundaries.
- Add or update tests when behavior changes.

## Modules

- Keep files focused: one job per module.
- Reuse and extend existing code before adding parallel implementations.
- Name things for intent, not implementation detail.

## Optional later

When your project grows, you can replace or extend this file with team-specific rules. Until then, these defaults are enough.
