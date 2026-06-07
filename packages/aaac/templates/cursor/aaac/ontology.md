# AAAC ontology (first principles)

SSOT: [ontology.json](ontology.json). Regenerate graph and commands:

```bash
npx @ludecker/aaac@latest generate
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

## Verbs

create · update · fix · review · check · test · release · remove

## Granular aliases

Finer nouns (api, endpoint, hook, spec, skill, graph, …) map to a canonical command — see `command_aliases` in [ontology.json](ontology.json). Examples:

| You type | Resolves to |
|----------|-------------|
| `/update-api` | `update-integration` |
| `/fix-hook` | `fix-function` |
| `/update-doc` | `update-architecture` |
| `/check-inventory` | `check-module` |
| `/create-skill` | `create-module` |

## Exceptions

| Command | Note |
|---------|------|
| `fix-bug` | Defect repair; routes to `verb-fix` + object `feature` by default |
| `fix-module` | Same fix swarm; routes to `verb-fix` + object `module` by default |
| `review-incident` | Production/deploy incident (`swarm-check` alias) |
| `test-function` | Journey verification (dedicated orchestrator) |
| `release-app` | Platform release swarm |

Add domain resolvers in `graph.project.yaml` to route `/update-module <slug>` to domain orchestrators.

## Invalid `release-*`

Use `release-app`, `release-feature`, or `release-integration` — not `release-function`, `release-module`, etc. (see `invalid_pairs` in graph).

## Verb lifecycle and gates

**Work:** [lifecycle/lifecycle.json](lifecycle/lifecycle.json)  
**Gates:** [governance/gates.json](governance/gates.json)  
**Run:** [run/schema.json](run/schema.json)

## Object capabilities

Ontology declares `object_capabilities` per object. Graph resolves providers via [capabilities/registry.json](capabilities/registry.json). Generic install uses shared skills; replace with project skills in your overlay.

Example: `component` → `[component-model, layer-boundaries, ui-design]` → `[component, architecture, component]`

## Domain argument

- **Recommended:** `update-module`, `fix-module`, … once you add domains
- **Optional:** `*-function`, `review-incident`

## Manual commands

Add filenames to [project.config.json](project.config.json) `manual_commands` — not generated from ontology.
