---
name: shared-reporting
description: >-
  AAAC user-facing report template. Plain language first. Not user-facing as a command.
disable-model-invocation: true
---

# Shared reporting

## Template

```markdown
## [Command] — [Short title]

**Bottom line:** [One sentence]

### What we did
- …

### Verification
- Tests: …
- Intent: …
- Confidence: architecture / requirements / scope
- Complexity: score / threshold / pass (create/update/fix only)
- Fitness: pass/warning/fail summary (include minimal_complexity)
- Impact: blast_radius, affected domains

### Rollback (if applicable)
- Plan reference or "not required"

### Skill synced
- [If applicable] domains/<slug>/update/inventory refreshed

### Follow-ups
- …

---
<details>
<summary>Technical details</summary>
…
</details>
```

Layman sections: no unexplained jargon. Put paths and commit refs in Technical details only.
