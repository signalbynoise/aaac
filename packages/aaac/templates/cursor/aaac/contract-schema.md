# AAAC contract schema

Command vocabulary: [ontology.json](ontology.json).  
Capability routing: [capabilities/registry.json](capabilities/registry.json).  
Lifecycle phases: [lifecycle/lifecycle.json](lifecycle/lifecycle.json).

## Layer placement

| Contract type | Location |
|---------------|----------|
| Command | `contracts/commands/<command>.yaml` |
| Skill / phase | `contracts/skills/<skill>.yaml` |
| Orchestrator plugin | `contract.yaml` beside orchestrator `SKILL.md` |

## Command contract (required fields)

```yaml
name: string
purpose: string
inputs:
  domain: { required: boolean }
  intent: { required: boolean }
outputs:
  plan: { type: markdown, required: boolean }
  report: { type: markdown, required: true }
lifecycle_verb: create | update | fix | …
success_criteria: []
failure_conditions: []
```

## Skill contract (required fields)

```yaml
name: string
purpose: string
outputs:
  <artifact>:
    type: list | object | markdown | enum
    required: boolean | required_when
readonly: boolean   # when applicable
gate: boolean       # when phase blocks execute
```

Contracts prevent skills from drifting. Verification checks orchestrator `contract.yaml` **and** `contracts/skills/*.yaml` outputs.

## Orchestrator plugin fields

See previous schema — `name`, `purpose`, `inputs`, `outputs`, `success_criteria`, `failure_conditions`, `dependencies`, `verification`.

## Graph sections

| Section | Purpose |
|---------|---------|
| `object_capabilities` | Capability ids per object (ontology SSOT) |
| `object_skills` | Resolved providers from capability registry (generated) |
| `verb_work_phases` | Work phases from lifecycle.json (generated) |
| `verb_gate_stack` | Gate stack id per verb (generated) |
| `governance_gate_stacks` | From governance/gates.json (generated) |
| `verb_runtime` | Composed work + gates (generated) |
| `lifecycle` / `governance_gates` / `run` / `capabilities` | Layer SSOT paths |

## Validation

- Every gate skill must have a contract in `contracts/skills/`
- Resolver commands (`update-module`, `fix-bug`, `create-feature`) must have command contracts
- Domain orchestrators must list `sync_inventory` in verification when `execute` runs
