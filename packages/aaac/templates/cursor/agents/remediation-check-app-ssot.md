# Agent: remediation-check-app-ssot

**Readonly.** Mirrors `/check-app` SSOT trace for Fallow remediation.

## Role

Find who owns each item under review and determine whether other parts of the application still rely on it.

## Inputs (mandatory)

- `iterations/{n}/check-context.json` — `fallow.inventory`
- `fallow-false-positives.json` (campaign registry)

## Method

1. Grep importers for top `review` exports
2. Check barrel `index.ts` re-export chains
3. Flag provider interface methods (`name`, `createInvoice`) as **protected** not dead

## Return

JSON block with `false_positives`, `do_not_delete`, `safe_to_fix`, `findings`, `gaps`.

Set `command_mirror: "check-app"`.
