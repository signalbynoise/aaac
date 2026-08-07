# Model routing policy (v1)

Parent orchestrators must resolve Task model selection from the SSOT at `.cursor/aaac/model-routing.yaml` before launching each Task subagent.

- Resolve with `.cursor/aaac/scripts/run-engine/resolve-model-for-phase.mjs` using phase + agent spec + subagent type.
- Pass the resolved `model` slug on the Task tool call.
- Treat v1 as guidance + telemetry: mismatches are recorded but do not hard-block launches.

## Pricing SSOT

Token USD rates live only in `.cursor/aaac/model-pricing.yaml` (Cursor Models & Pricing docs). Refresh with `node .cursor/aaac/scripts/run-engine/refresh-model-pricing.mjs`. Stage cost estimates use `estimate-token-cost.mjs` — never hardcode prices in UI or stage summaries.

**Cost only when metered:** `estimated_cost_usd` is set only from sealed agent/phase token meters + pricing rates. Do not invent cost via `duration_share_of_conversation_tokens`, chars/4, or conversation chrome. When Cursor omits meters, cost and agent token fields stay null / `unavailable`.
