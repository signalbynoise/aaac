# AAAC ontology (first principles)

SSOT: [ontology.json](ontology.json). Regenerate graph and commands:

```bash
node .cursor/aaac/generate-graph.mjs
node .cursor/aaac/generate-commands.mjs
```

## Hierarchy (how developers already think)

```text
function → component → module → feature → domain → system
```

Four layers in the graph:

| Layer | Objects | Examples |
|-------|---------|----------|
| **code** | function, component, module | `/fix-function`, `/review-component`, `/update-module` |
| **data** | schema, model, migration | `/update-schema`, `/create-migration` |
| **product** | feature, workflow, integration | `/create-feature`, `/check-workflow` |
| **system** | app, domain, architecture | `/release-app`, `/update-domain`, `/review-architecture` |

## Verbs (unchanged)

create · update · fix · review · check · test · release · remove

## Ludecker domains

| Slug | Bounded context |
|------|-----------------|
| `cms` | `apps/website` — public site + CMS admin |
| `ui` | `packages/ui` — design system |
| `database` | `supabase/migrations` — schema, RLS, type mirrors |

## Granular aliases

Finer nouns (api, endpoint, hook, spec, skill, graph, …) map to a canonical command — see `command_aliases` in [ontology.json](ontology.json). Examples:

| You type | Resolves to |
|----------|-------------|
| `/update-api` | `update-integration` |
| `/fix-hook` | `fix-function` |
| `/update-doc` | `update-architecture` |
| `/update-design` | `update-component` (cms/ui resolver) |
| `/check-inventory` | `check-module` |
| `/create-skill` | `create-module` |
| `/ship-ludecker` | `release-app` |

## Exceptions

| Command | Note |
|---------|------|
| `fix-bug` | Defect repair; domain resolver (`cms`, `ui`, `database`); unknown slug → `verb-fix` |
| `review-incident` | Production/deploy incident (`swarm-check` alias) |
| `test-function` | Journey verification (dedicated orchestrator) |
| `release-app` | Full platform ship (`ship-ludecker` alias) |
| `write-article` | Content research swarm → CMS persist |

## Invalid `release-*`

Use `release-app`, `release-feature`, or `release-integration` — not `release-function`, `release-module`, `release-schema`, etc. (see `invalid_pairs` in graph).

## Verb lifecycle and gates

**Work:** [lifecycle/lifecycle.json](lifecycle/lifecycle.json) → graph `verb_work_phases`  
**Gates:** [governance/gates.json](governance/gates.json) → graph `governance_gate_stacks`  
**Runtime (composed):** graph `verb_runtime` on Run at dispatch  
**Run:** [run/schema.json](run/schema.json) — primary execution object  

Phase → skill: [lifecycle/phases.json](lifecycle/phases.json)

## Object capabilities

Ontology declares `object_capabilities` per object. Graph resolves to provider skills via [capabilities/registry.json](capabilities/registry.json). Generated `object_skills` in graph.yaml is derived — do not edit by hand.

Example: `component` → `[component-model, layer-boundaries, ui-design]` → `[component, architecture, ludecker-design-system]`

## Domain argument

- **Required:** `update-module`, `update-domain`, …
- **Optional:** `*-function`, `review-incident`, `write-article`

## Manual commands (not in graph)

| Command | Purpose |
|---------|---------|
| `/launch-ludecker` | Local dev: kill stale processes, clean `.next`, start `pnpm dev` |
| `/kill-ludecker` | Kill local dev port listeners |
