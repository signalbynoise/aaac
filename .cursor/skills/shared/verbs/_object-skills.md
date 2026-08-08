# Object → skill routing (verb orchestrators)

Read `object` from graph `commands.<name>.object`. Load **capabilities** from `object_capabilities.<object>`, resolve to provider skills via [capabilities/registry.json](../../../aaac/capabilities/registry.json). Graph `object_skills` is the resolved output.

Extra capabilities per verb: `object_capability_verbs` in ontology (resolved to `object_skill_verbs` in graph).

Layers: **code → data → product → system**.

## Base map (`object_skills`)

| object | Layer | Focus skill(s) |
|--------|-------|----------------|
| function | code | (discovery only) |
| component | code | component, architecture |
| module | code | domain inventory when slug present |
| schema | data | schema |
| model | data | model, schema |
| migration | data | migration, schema |
| feature | product | workflow |
| workflow | product | workflow |
| integration | product | integration |
| app | system | architecture |
| domain | system | domain |
| architecture | system | architecture, documentation |

## Verb extras (`object_skill_verbs`)

| object | verb | Extra skills |
|--------|------|--------------|
| module | create | module-authoring |
| module | review | architecture |
| feature | create | module-authoring |

## Domain inventory (mandatory when slug resolves)

For **`fix`**, **`update`**, **`test`**, **`fix-bug`**, **`update-module`**, **`create-feature`**, **`test-module`**:

1. If `domains/<slug>/update/inventory/SKILL.md` exists → read **before** discovery
2. If missing → [module-authoring](../module-authoring/SKILL.md) bootstrap **or** ask user to pick a generic verb-object command

**Do not** load `module-authoring` on **`fix-*`** unless bootstrapping a missing domain.

## Resolver overrides

Domain resolvers in graph override generic verb paths for `update-module`, `update-component`, `create-feature`, `fix-bug`, `test-module`, `update-architecture`.

`fix-bug-by-slug` with unknown slug → `verb-fix` with `default_object: feature` per graph.

## Investigation depth

| Verb | Skill |
|------|-------|
| create, update | [investigation-lite](../investigation-lite/SKILL.md) |
| fix, fix_mode | [investigation](../investigation/SKILL.md) → [root-cause](../root-cause/SKILL.md) |

## Pre-execute gates

See [_lifecycle.md](./_lifecycle.md): validation → impact-analysis → dependency-graph → fitness-functions → rollback (when required).

Utilities: [_dispatch-utils.md](./_dispatch-utils.md)
