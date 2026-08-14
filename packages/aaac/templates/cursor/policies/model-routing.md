# Model routing policy (v2)

AAAC may only run **Grok 4.6** variants. No other model provider is allowed.

Parent orchestrators must resolve Task model selection from the SSOT at `.cursor/aaac/model-routing.yaml` before launching each Task subagent.

- Resolve with `.cursor/aaac/scripts/run-engine/resolve-model-for-phase.mjs` using phase + agent spec + subagent type.
- Pass the resolved `model` slug on the Task tool call. Do not pass `inherit`, Composer, Claude, GPT, or any non-Grok slug.
- The Cursor composer picker and `CURSOR_MODEL` must not override phase routing.
- Non-Grok slugs in routing YAML are coerced to the Grok 4.6 default for that tier.
- Agentic OS / headless Cursor CLI adapters resolve the phase model from this SSOT and ignore other providers.

## Tiers (Grok 4.6 only)

| Tier | Slug | Used for |
|------|------|----------|
| `fast` | `grok-4.6-fast` | Discover, verify, review, explore |
| `codex` | `grok-4.6-high` | Execute, test_execute, code-author |
| `reasoning` | `grok-4.6-xhigh` | Plan, gates, root cause, report |

## Pricing SSOT

Token USD rates live only in `.cursor/aaac/model-pricing.yaml` (Cursor Models & Pricing docs). Refresh with `node .cursor/aaac/scripts/run-engine/refresh-model-pricing.mjs`. Stage cost estimates use `estimate-token-cost.mjs` — never hardcode prices in UI or stage summaries.

**Cost only when metered:** `estimated_cost_usd` is set only from sealed agent/phase token meters + pricing rates. Do not invent cost via `duration_share_of_conversation_tokens`, chars/4, or conversation chrome. When Cursor omits meters, cost and agent token fields stay null / `unavailable`.
