# Verb lifecycle (SSOT)

**Lifecycle = work.** **Gates = approval/checkpoints.** They are separate SSOTs, composed at runtime.

| SSOT | Path | Contains |
|------|------|----------|
| Work phases | [lifecycle/lifecycle.json](../../lifecycle/lifecycle.json) | `verbs.*.work_phases` |
| Gate stacks | [governance/gates.json](../../governance/gates.json) | `stacks.*` |
| Runtime (composed) | [graph.yaml](../../graph.yaml) `verb_runtime` | work through plan + gates + execute onward |
| Run | [run/schema.json](../../run/schema.json) | Primary execution object |

Phase id → skill mapping: **[lifecycle/phases.json](../../lifecycle/phases.json)**

Responsibility layers: **[layers.md](../../layers.md)**

## Mental model

```text
Run
  work:     discover → investigate* → plan
  gates:    validate → impact → deps → fitness → rollback
  work:     execute → verify → report
```

Everything executes within a Run. Observability (`decisions`, `log`, `checkpoints`) lives on the Run — no standalone logging.

## Phase → skill map

| Phase | Kind | Skill |
|-------|------|-------|
| `discover` | work | discovery |
| `investigate_lite` | work | investigation-lite |
| `investigate` | work | investigation (legacy id; use investigate_swarm) |
| `investigate_swarm` | work | investigation Mode A |
| `root_cause` | work | root-cause |
| `plan` | work | planning |
| `validate` | gate | validation |
| `impact_analysis` | gate | impact-analysis |
| `dependency_graph` | gate | dependency-graph |
| `fitness_functions` | gate | fitness-functions |
| `rollback` | gate | rollback |
| `execute` | work | execution |
| `verify` | work | testing + verification |
| `report` | work | reporting |

## Verb work phases (from lifecycle.json)

| Verb | Work | Gate stack |
|------|------|------------|
| create | discover → investigate_lite → plan → execute → verify → report | pre_execute |
| update | same | pre_execute |
| fix | discover → investigate_swarm → root_cause → plan → execute → verify → report | pre_execute |
| review | discover → plan → report | none |
| check | discover → report | pre_execute_minimal |
| test | discover → plan → verify → report | none |
| release | execute → verify → report | release |
| remove | same as update | pre_execute |

## Capability routing

Objects declare **capabilities** in ontology (`object_capabilities`). The registry resolves providers:

```text
object → capability → provider (skill | mcp | expert)
```

Graph `object_skills` includes **skill-type** providers only. MCP providers are recorded on Run `capabilities_resolved` and `decisions[]`. Do not hardcode provider names in orchestrators.

## Human approval

Gate failure or low confidence → Run:

```yaml
status: blocked
awaiting_approval: true
blocked_reason: "…"
```

STOP until user approves. Record approval in `decisions[]`.

## Escalation

If gate fails and user has not approved:

```text
STOP — awaiting approval
Run: {run_id}
```
