---
name: implementation
description: Enforces project master rules and architecture when implementing code. Read {{DOCS_ROOT}}/master_rules.md, {{DOCS_ROOT}}/ui_design.md (UI/CSS), {{DOCS_ROOT}}/project_context.md, and {{DOCS_ROOT}}/architecture.md before any code change.
---

# Implementation

All code changes must comply with your project docs. **If implementation conflicts with those docs, the docs win.**

| Document | Path | Governs |
|----------|------|---------|
| Master Rules | [{{DOCS_ROOT}}/master_rules.md](../../../../{{DOCS_ROOT}}/master_rules.md) | Architecture, layers, SSOT, testing |
| UI Design | [{{DOCS_ROOT}}/ui_design.md](../../../../{{DOCS_ROOT}}/ui_design.md) | CSS discipline, selectors, layout, a11y |
| Project Context | [{{DOCS_ROOT}}/project_context.md](../../../../{{DOCS_ROOT}}/project_context.md) | Repo paths, SSOT anchors, tooling |
| Architecture | [{{DOCS_ROOT}}/architecture.md](../../../../{{DOCS_ROOT}}/architecture.md) | System shape, modules, data flow, deploy |

Read the relevant sections **before** implementing. Add project-specific object skills under `.cursor/skills/<project>/` and wire them in `capabilities/registry.json` when you outgrow the generic defaults.

---

## Before You Write Code

1. **Identify the layer** you are touching (UI, state, domain, infrastructure).
2. **Read** the matching section in master rules and architecture docs.
3. **UI/CSS work:** read [ui_design.md](../../../../{{DOCS_ROOT}}/ui_design.md) — shallow CSS, no premature token architecture (Rules §5, §41).
4. **Check reuse** — extend existing modules before adding new ones.
5. **Respect boundaries** — UI renders only; domain owns rules; infrastructure persists.

---

## Layer placement (generic)

| Layer | Responsibility | Must not |
|-------|----------------|----------|
| UI | Render + interaction | Fetch, business rules, direct DB |
| State | Transitions | UI markup, persistence |
| Domain | Rules, invariants | Framework imports where avoidable |
| Infrastructure | APIs, DB, adapters | Business decisions |

Direction: **Input → State → Logic → Output**. No circular imports across layers.

---

## Checklist (execute phase)

- [ ] Values from config/constants — no unexplained literals
- [ ] Class-based CSS per ui_design.md — no inline styles; shallow selectors
- [ ] One component per file; named exports
- [ ] Async ops: cancellable, logged at boundaries
- [ ] Tests appropriate to the change (unit for domain, integration for boundaries)

---

## Project overlay (optional)

Generic rules ship in `{{DOCS_ROOT}}/master_rules.md` and work without edits. Put repo-specific paths and SSOT anchors in `{{DOCS_ROOT}}/project_context.md`. When you outgrow defaults, extend those docs or add a `skills/<project>/implementation/` skill and wire it in `graph.project.yaml`.
