#!/usr/bin/env bash
# AAAC preToolUse: read budgets then write-phase gates. failClosed in hooks.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Cursor may invoke from workspace root; prefer relative .cursor paths.
READ_GATE=".cursor/aaac/scripts/run-engine/gate-read-budget.mjs"
WRITE_GATE=".cursor/aaac/scripts/run-engine/gate-write.mjs"
if [[ ! -f "$READ_GATE" ]]; then
  READ_GATE="$ROOT/aaac/scripts/run-engine/gate-read-budget.mjs"
fi
if [[ ! -f "$WRITE_GATE" ]]; then
  WRITE_GATE="$ROOT/aaac/scripts/run-engine/gate-write.mjs"
fi

# Tee stdin so both gates see the hook payload.
payload="$(cat)"
read_out="$(printf '%s' "$payload" | node "$READ_GATE" || true)"
if echo "$read_out" | grep -q '"permission"[[:space:]]*:[[:space:]]*"deny"'; then
  printf '%s\n' "$read_out"
  exit 0
fi
printf '%s' "$payload" | exec node "$WRITE_GATE"
