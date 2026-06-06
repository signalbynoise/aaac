# AAAC command dispatch (shared by all slash commands)

Agents running any AAAC command **must** follow this sequence.

**Enforcement (runtime):** Cursor hooks in [.cursor/hooks.json](../hooks.json) create Runs and **block code edits** until the `execute` phase. See [.cursor/rules/aaac-enforcement.mdc](../rules/aaac-enforcement.mdc). Applies to **all** AAAC slash commands.

**Path convention:** In [graph.yaml](graph.yaml), paths under `agents/`, `policies/`, `skills/`, and `domains/` are relative to **`.cursor/`**.

**Primary execution object:** Every command runs inside a **Run** — see [run/RUN.md](run/RUN.md) and [run/schema.json](run/schema.json).

## 0. Hook-initiated Run (automatic)

On submit, hooks call [scripts/run-engine/init-run.mjs](../scripts/run-engine/init-run.mjs). Follow `run.json` phases. `preToolUse` denies Write/StrReplace/Delete outside allowed phases.

Advance after swarm + artifacts:

```bash
node .cursor/aaac/scripts/run-engine/advance-phase.mjs <run_id> <completed_phase>
```

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

**Workflow exceptions:** Commands like `write-article` use `command_workflows.<command>` in graph (not `verb_runtime`). `fix-module` and `fix-bug` also have explicit workflows matching the fix verb runtime. No governance gate stack unless orchestrator specifies one.

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
- **Capabilities:** resolve `object_capabilities.<object>` via [capabilities/registry.json](capabilities/registry.json) — `init-run.mjs` records providers on `Run.capabilities_resolved`; on completion `capability-evidence.mjs` aggregates evidence into [state/capability-stats.json](state/capability-stats.json) and evaluates [capabilities/promotion-rules.json](capabilities/promotion-rules.json)
- **Dependencies:** [dependencies.yaml](dependencies.yaml)
- **Fitness:** [fitness-functions.yaml](fitness-functions.yaml) — includes `minimal_complexity` for create/update/fix
- **Complexity:** [complexity.yaml](complexity.yaml) + [minimal-complexity.md](../policies/minimal-complexity.md) for create/update/fix
- **Contracts:** validate against [contracts/commands/](contracts/commands/) and [contracts/skills/](contracts/skills/)

## 2.5 Create or resume Run

Before loading orchestrator:

1. **Create** `state/runs/{run_id}/run.json` per [run/schema.json](run/schema.json)
2. Set `pending` from `command_workflows.<command>` when present, else `verb_runtime.<verb>`
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
  - [minimal-complexity.md](../policies/minimal-complexity.md) — **create / update / fix only**
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
| **validate** | [validation/SKILL.md](../skills/shared/validation/SKILL.md) — confidence + **complexity plan** |
| **impact_analysis** | [impact-analysis/SKILL.md](../skills/shared/impact-analysis/SKILL.md) |
| **dependency_graph** | [dependency-graph/SKILL.md](../skills/shared/dependency-graph/SKILL.md) |
| **fitness_functions** | [fitness-functions/SKILL.md](../skills/shared/fitness-functions/SKILL.md) — **`minimal_complexity` blocks on fail** |
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
| fix | [investigation](../skills/shared/investigation/SKILL.md) Mode A (7-agent swarm) → [root-cause](../skills/shared/root-cause/SKILL.md) |

### Fix swarm (mandatory on fix verb / fix_mode)

1. **discover** — 4–6 parallel Task agents per [discovery/SKILL.md](../skills/shared/discovery/SKILL.md)
2. **investigate_swarm** — 7 parallel Task agents per investigation Mode A — **one message**
3. **root_cause** — artifact required; confidence ≥ 0.7 before plan
4. **verify** — fix verify swarm (3 parallel) per [testing/SKILL.md](../skills/shared/testing/SKILL.md); **website build gate** (`verify-website-build.mjs`) must pass for create/update/fix; fail if `repro_status: not_fixed`

Skipping swarms because the issue "looks simple" is a **contract violation** for `fix-module` / `fix-bug` / `fix_mode`.

## 5. Report

[reporting/SKILL.md](../skills/shared/reporting/SKILL.md) — plain language first; include confidence, impact, fitness, rollback from Run artifacts. Set Run `status: completed`.

## Regenerating

```bash
node .cursor/aaac/generate-graph.mjs
node .cursor/aaac/generate-commands.mjs
```
