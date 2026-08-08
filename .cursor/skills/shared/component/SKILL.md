---
name: shared-component
description: >-
  UI components, views, pages, forms, hooks-as-UI. Object component (code layer).
  Not user-facing.
disable-model-invocation: true
---

# Shared component

## Scope

- `src/app/components/`, routes-as-views, layout composition
- Props-driven components; token/class styling only (no inline styles)
- One component per file; no inline component definitions

## Execution focus

- Reuse design system primitives; match existing patterns
- Accessibility and test ids for interactive flows

## Review focus

- Re-render boundaries, prop drilling, separation from state layer
