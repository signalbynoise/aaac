---
name: implementation
description: Enforces project master rules and architecture when implementing code. Read {{DOCS_ROOT}}/master_rules.md and {{DOCS_ROOT}}/architecture.md before any code change.
---

# Implementation

All code changes must comply with your project docs. **If implementation conflicts with those docs, the docs win.**

| Document | Path | Governs |
|----------|------|---------|
| Master Rules | [{{DOCS_ROOT}}/master_rules.md](../../../../{{DOCS_ROOT}}/master_rules.md) | Architecture, layers, SSOT, testing |
| Architecture | [{{DOCS_ROOT}}/architecture.md](../../../../{{DOCS_ROOT}}/architecture.md) | System shape, modules, data flow, deploy |

Read the relevant sections **before** implementing. Add project-specific object skills under `.cursor/skills/<project>/` and wire them in `capabilities/registry.json` when you outgrow the generic defaults.

---

## Before You Write Code

1. **Identify the layer** you are touching (UI, state, domain, infrastructure).
2. **Read** the matching section in master rules and architecture docs.
3. **Check reuse** — extend existing modules before adding new ones.
4. **Respect boundaries** — UI renders only; domain owns rules; infrastructure persists.

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
- [ ] Token/class-based CSS — no inline styles in UI components
- [ ] One component per file; named exports
- [ ] Async ops: cancellable, logged at boundaries
- [ ] Tests appropriate to the change (unit for domain, integration for boundaries)

---

## Project overlay

After `npx @ludecker/aaac init`, replace this generic skill with project-specific rules, or add a `skills/<project>/implementation/` skill and point `execution` depends in `graph.project.yaml`.
