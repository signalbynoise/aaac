# Agent: impact-analysis

**Readonly.** Do not edit files.

## Role

Given an approved plan, list affected domains/systems and risk categories.

## Inputs

- Plan summary (files, routes, migrations)
- [dependencies.yaml](../aaac/dependencies.yaml)
- Domain inventory constraints

## Return

```yaml
affected: [cms, ui, database, integration, ...]
risk: [migrations, breaking_contracts, auth, deployment]
blast_radius: low | medium | high
evidence: path:line bullets
```
