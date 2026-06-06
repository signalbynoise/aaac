# AAAC — responsibility layers

AAAC is organized by **responsibility**, not by file type. Paths below map logical layers to current repo locations.

## Layer model

```text
User Layer
├─ Commands                    .cursor/commands/

Control Layer
├─ Ontology                    .cursor/aaac/ontology.json, ontology.md
├─ Dispatch                    .cursor/aaac/dispatch.md
├─ Graph                       .cursor/aaac/graph.yaml

Lifecycle Layer (work)
├─ Work phase definitions      .cursor/aaac/lifecycle/phases.json
├─ Verb work lifecycles        .cursor/aaac/lifecycle/lifecycle.json

Governance Layer (gates + rules)
├─ Gate stacks                 .cursor/aaac/governance/gates.json
├─ Policies                    .cursor/policies/
├─ Rules                       .cursor/rules/
├─ Dependencies                .cursor/aaac/dependencies.yaml
├─ Fitness functions           .cursor/aaac/fitness-functions.yaml

Run Layer (primary execution object)
├─ Run schema                  .cursor/aaac/run/schema.json
├─ Run protocol                .cursor/aaac/run/RUN.md
├─ Run storage                 .cursor/aaac/state/runs/{run_id}/run.json
├─ Observability on Run        run.decisions, run.log, run.checkpoints

Execution Layer
├─ Domain orchestrators        .cursor/domains/<slug>/update/orchestrator/
├─ Verb orchestrators          .cursor/skills/shared/verbs/*/orchestrator/
├─ Shared pipeline skills      .cursor/skills/shared/
├─ Capability registry         .cursor/aaac/capabilities/registry.json
├─ Agent specs                 .cursor/agents/

Knowledge Layer
├─ Documentation               docs/agentic_architecture.md, docs/architecture.md, …

Contracts Layer (cross-cutting)
├─ Schema                      .cursor/aaac/contract-schema.md
├─ Command contracts           .cursor/aaac/contracts/commands/
├─ Skill contracts             .cursor/aaac/contracts/skills/
```

## Responsibilities

| Component | Layer | Responsibility |
|-----------|-------|----------------|
| Commands | User | User-facing API |
| Ontology | Control | Vocabulary and classification |
| Dispatch | Control | Command resolution and escalation |
| Graph | Control | Execution routing |
| Lifecycle | Lifecycle | **Work** phase configuration |
| Gate stacks | Governance | **Approval** checkpoints |
| Run | Run | Primary execution object; state + observability |
| Domain orchestrators | Execution | Domain coordination |
| Shared pipeline skills | Execution | Phase execution |
| Capability registry | Execution | object → capability → provider |
| Agent specs | Execution | Agent behavior |
| Policies | Governance | Mandatory governance |
| Contracts | Contracts | Input/output invariants |
| Documentation | Knowledge | System knowledge |

## Questions each layer answers

| Layer | Question |
|-------|----------|
| User | What does the user want? |
| Control | What command, object, orchestrator? |
| Lifecycle | What **work** happens, in what order? |
| Governance | What **gates** must pass? What rules apply? |
| Run | Where are we? Why? What was decided? |
| Execution | Who does the work? |
| Contracts | What must be true in/out? |
| Knowledge | What does the system mean? |

## Load order (mutating commands)

```text
Policies → Ontology → Graph → Create Run
→ Lifecycle (work) + Gates (composed into Run.pending)
→ Orchestrator → Capabilities resolved (recorded on Run)
→ Execute phases → Update Run → Report
```

## Deprecated

- `state/execution-state.yaml` — superseded by `run/schema.json`
- `observability/decision-log.md`, `execution-log.md` — superseded by Run fields
