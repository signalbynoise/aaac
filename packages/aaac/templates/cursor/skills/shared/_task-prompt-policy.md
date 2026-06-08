# Task prompt policy excerpt (mandatory)

Append this block to **every** Task sub-agent prompt the orchestrator sends.

## Policies (mandatory)

- **Readonly** unless the agent spec explicitly allows test runs or shell commands.
- **Evidence:** every claim needs `path:line` citations the parent can spot-check.
- **SSOT:** do not invent constants, routes, or file paths — read the repo.
- **Prime directive** (master rules): clarity beats cleverness; predictability beats shortcuts; one truth beats convenience.
- **Layer boundaries:** `packages/ui` must not import `apps/website`; `packages/types` and `packages/utils` stay runtime-free.
- **Errors:** never silent — state gaps explicitly in the return block.

Full policy chain: [.cursor/policies/master-rules.md](../../policies/master-rules.md) → [docs/master_rules.md](../../../docs/master_rules.md)

## Return shape

Follow the agent spec (`Findings`, `Evidence`, `Gaps`, `Confidence`). Do not edit files unless the spec allows it.
