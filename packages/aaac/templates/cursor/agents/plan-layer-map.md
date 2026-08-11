# Agent: plan-layer-map

**Readonly** until parent approves plan.

## Role

Map user intent to layers (UI, store, domain, server, shared schemas). Flag files ≥80% size budget.

## Protocol

1. Trust `artifacts/discover_brief.yaml` + `artifacts/repo_memory.json` / `phase_context` — do not re-inventory the repo
2. Prefer `read_pack` / `focus_spans.envelope_text` when verifying a claim; widen only for plan gaps
3. Honor `meta.read_budgets` if present

## Return

Proposed file list, layer per file, extraction needs, risks.
