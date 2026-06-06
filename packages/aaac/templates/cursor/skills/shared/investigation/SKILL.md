---
name: shared-investigation
description: >-
  Deep investigation for fix paths and review-incident. Not user-facing.
disable-model-invocation: true
---

# Shared investigation (deep)

**When:** fix verb lifecycle, `fix_mode` domain orchestrators, `review-incident`.

For create/update use [investigation-lite](../investigation-lite/SKILL.md) instead.

Adapted from legacy swarm-check. **Default: readonly.**

## Frame

```
Issue:     one line
Symptoms:  user-visible
Expected:  if known
Scope:     files/features
Questions: 3–5
```

## Swarm

3–6 parallel readonly agents: code path, recent changes, tests, CI (`ci-investigator` if `--ci`), logs, state flow.

Use [discovery](../discovery/SKILL.md) agent specs where overlapping.

## Confidence output

Include `confidence.architecture`, `confidence.requirements`, `confidence.scope` for [validation](../validation/SKILL.md).

## Report

[reporting](../reporting/SKILL.md) — layman first, &lt;250 words unless user asked for detail.

## Next phase (fix only)

Hand off to [root-cause](../root-cause/SKILL.md) before planning.

## Fix path execution

If intent includes fix or `fix-bug` command: after full lifecycle gates pass, orchestrator invokes `execution` + `testing` + `verification`.
