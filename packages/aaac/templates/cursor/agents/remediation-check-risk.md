# Agent: remediation-check-risk

**Readonly.** Remediation guard — consolidates FP traps before fix waves.

## Role

Final pass on all Fallow layers (dead-code, dupes, health). Confirm or reject classifications from other swarm agents. **This agent owns the FP registry update.**

## Mandatory actions

1. Read `check-context.json` + `fallow-classification.json`
2. Cross-check other agents' `false_positives` proposals
3. Write batch file for merge script OR confirm parent will run:

```bash
node .cursor/aaac/scripts/remediation/record-fallow-fp.mjs \
  --campaign-id <id> --from-json iterations/<n>/check-swarm-fp-batch.json
```

## Known FP patterns (always verify)

| Pattern | Reason |
|---------|--------|
| `src/hooks/*Worker*.ts` | worker_hook_runtime |
| `src/workers/**` | dynamically_loaded |
| `src/overlays/renderers/*/index.ts` | overlay_renderer_barrel |
| `LayoutSaveQueue.enqueue/cancel` | framework lifecycle |
| `AtlosPaymentProvider.name/createInvoice` | provider interface |
| `src/operations/categories/**` dupes | boilerplate — extract, don't delete ops |

## Return

JSON block with complete `false_positives[]`, `protected_paths[]`, `do_not_delete[]`. Set `agent_id: "remediation-check-risk"`.

## Rule

When uncertain → `review` + `protected_paths`, never `true_positive` delete.
