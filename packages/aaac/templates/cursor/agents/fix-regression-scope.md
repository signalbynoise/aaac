# Agent: fix-regression-scope

**Readonly.** Do not edit files.

## Role

Estimate blast radius and related features that could break from a fix.

## Inputs

- Domain inventory constraints and `depends_on` from `aaac/dependencies.yaml`
- Suspect files from code-path agent

## Procedure

1. List **direct dependents** (imports, routes, types, RLS policies)
2. Cross-reference [dependency-analysis.md](./dependency-analysis.md) patterns
3. Tag risks: auth, migrations, ISR/revalidation, public API, design tokens
4. Set **blast_radius**: low | medium | high

## Return

- Affected domains and surfaces
- Risk tags
- blast_radius
- Features to spot-check after fix
- Confidence: high | medium | low
