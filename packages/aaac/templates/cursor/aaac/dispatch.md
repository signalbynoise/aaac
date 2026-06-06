# AAAC command dispatch (shared by all slash commands)

Agents running any AAAC command **must** follow this sequence.

**Path convention:** In [graph.yaml](graph.yaml), paths under `agents/`, `policies/`, `skills/`, and `domains/` are relative to **`.cursor/`**.

**Primary execution object:** Every command runs inside a **Run** — see [run/RUN.md](run/RUN.md) and [run/schema.json](run/schema.json).

## 1. Parse input

From `$ARGUMENTS` and the user message:

| Slot | Rule |
|------|------|
| Command | Filename without `.md` (e.g. `update-module`) |
| Domain | See [ontology.md](ontology.md); optional for `review-incident` and `*-function` |
| Intent | Quoted string `"…"` or remainder after domain |
| Verb | First segment of command (e.g. `update-module` → verb `update`) |

If intent contains `Sync inventory only` (case-insensitive), orchestrator runs **sync_inventory** phase only (no execution).

**Resume:** If user references `run_{id}`, load `state/runs/{run_id}/run.json` and continue from `phase`.

**Aliases:** `commands.<name>.alias` → resolve canonical command (e.g. `update-api` → `update-integration`) and continue.

Legacy names (`module-update`, `architecture`, `swarm-check`, …) are aliases in [graph.yaml](graph.yaml).

## 2. Load graph

Read [graph.yaml](graph.yaml) and [ontology.json](ontology.json).

- Reject unknown commands; suggest nearest alias if typo matches `command_aliases`
- Reject `invalid_pairs` with valid alternative (e.g. `release-module` → `release-app`)
- Resolve `commands.<name>` → orchestrator, `object`, `alias`, or `resolver` + slug map
- **Resolver fallback:** if slug missing from resolver `map`, use resolver `default` orchestrator and `default_object` when set
- **Object** comes from graph `object` field — load skills from `object_skills.<object>` and `object_skill_verbs.<object>.<verb>` per [verbs/_object-skills.md](../skills/shared/verbs/_object-skills.md)
- **Lifecycle (work):** [lifecycle/lifecycle.json](lifecycle/lifecycle.json) `verbs.*.work_phases`
- **Gates (approval):** [governance/gates.json](governance/gates.json) — composed into runtime per `verb_runtime` in graph
- **Maturity:** read `object_maturity.<object>` and apply `maturity_rules.<level>` (may require extra gate phases)
- **Capabilities:** resolve `object_capabilities.<object>` via [capabilities/registry.json](capabilities/registry.json) — record all providers (skill + mcp) on Run
- **Dependencies:** [dependencies.yaml](dependencies.yaml)
- **Fitness:** [fitness-functions.yaml](fitness-functions.yaml)
- **Contracts:** validate against [contracts/commands/](contracts/commands/) and [contracts/skills/](contracts/skills/)

## 2.5 Create or resume Run

Before loading orchestrator:

1. **Create** `state/runs/{run_id}/run.json` per [run/schema.json](run/schema.json)
2. Set `pending` from `verb_runtime.<verb>` in graph (work + gates composed)
3. Set `status: running`, first `phase`, `phase_kind: work`
4. Record resolved orchestrator, object, domain, intent on Run

All state and observability live on the Run — **no** standalone execution-state or markdown logs.

## 3. Load orchestrator

- Read `orchestrators.<id>.path` → `SKILL.md` + `contract.yaml` if present
- Read `inventory` when set on orchestrator
- Load every skill in `requires` (+ `optional` when fix/create modes need it)
- Load object skills from graph `object_skills` / `object_skill_verbs` for the command verb + object
- Load [.cursor/policies/](../policies/) — all skills inherit:
  - [master-rules.md](../policies/master-rules.md)
  - [implementation.md](../policies/implementation.md)
  - [mcp-and-deploy.md](../policies/mcp-and-deploy.md)
- Read [verbs/_dispatch-utils.md](../skills/shared/verbs/_dispatch-utils.md) for inventory + investigation rules
- Read [run/SKILL.md](../skills/shared/run/SKILL.md) for Run update protocol

## 4. Execute phases (Run-driven)

Run phases **in order** from Run `pending` (matches `verb_runtime`). Map phase id → skill via [lifecycle/phases.json](lifecycle/phases.json).

**After every phase** — update Run per [run/RUN.md](run/RUN.md):

- Append `log[]`, move phase to `completed`, write checkpoint, store artifacts
- Record routing and capability resolution in `decisions[]`
- Persist `run.json`

### Work vs gate

| `phase_kind` | Phases | Purpose |
|--------------|--------|---------|
| `work` | discover … plan, execute … report | Do the work |
| `gate` | validate, impact_analysis, dependency_graph, fitness_functions, rollback | Approval / checkpoints |

Gates run after `plan`, before `execute` (or before `report` when verb has no execute).

### Gate rules

| Gate | Skill |
|------|-------|
| **validate** | [validation/SKILL.md](../skills/shared/validation/SKILL.md) |
| **impact_analysis** | [impact-analysis/SKILL.md](../skills/shared/impact-analysis/SKILL.md) |
| **dependency_graph** | [dependency-graph/SKILL.md](../skills/shared/dependency-graph/SKILL.md) |
| **fitness_functions** | [fitness-functions/SKILL.md](../skills/shared/fitness-functions/SKILL.md) |
| **rollback** | [rollback/SKILL.md](../skills/shared/rollback/SKILL.md) when maturity or blast radius requires |

### Human approval at gate boundaries

When a gate fails or confidence is below threshold:

```yaml
status: blocked
awaiting_approval: true
blocked_reason: "<specific reason>"
```

```text
STOP — awaiting approval
Reason: {blocked_reason}
Run: {run_id}
```

Do **not** proceed until user approves in chat. On approval: log decision, set `status: running`, `awaiting_approval: false`, retry gate or continue.

**Code changes:** [governance/implementation/SKILL.md](../skills/shared/governance/implementation/SKILL.md) is mandatory for `execute`.

**Investigation depth:**

| Verb | Investigation |
|------|----------------|
| create | [investigation-lite](../skills/shared/investigation-lite/SKILL.md) |
| update | [investigation-lite](../skills/shared/investigation-lite/SKILL.md) |
| fix | [investigation](../skills/shared/investigation/SKILL.md) → [root-cause](../skills/shared/root-cause/SKILL.md) |

## 5. Report

[reporting/SKILL.md](../skills/shared/reporting/SKILL.md) — plain language first; include confidence, impact, fitness, rollback from Run artifacts. Set Run `status: completed`.

## Regenerating

```bash
node .cursor/aaac/generate-graph.mjs
node .cursor/aaac/generate-commands.mjs
```
