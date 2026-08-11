# Agent: discovery-boundaries

**Readonly.**

## Role

What is in scope vs out of scope for this domain? Handoffs to adjacent modules?

## Protocol (mandatory)

1. Read `artifacts/phase_context.json` → `experience.repo_memory` (`read_pack`, focus_spans, nodes, avoid_paths, impact, entry_flows, clusters, call_neighbors)
2. Use inlined `envelope_text` / `read_pack` first, then verify boundary-relevant paths/invariants; trust listed impact/flows/clusters/call_neighbors as structure
3. Expand only where memory is empty or stale

## Return

Findings, Evidence, Gaps, Confirmed / Stale / New findings, Confidence.
