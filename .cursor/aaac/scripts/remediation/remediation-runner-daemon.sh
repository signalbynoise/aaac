#!/usr/bin/env bash
# Deprecated for interactive use — prefer remediation-cli.mjs watch in Cursor terminal.
# This wrapper still runs the machine sentinel watcher for headless CI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
RUN_ID="${1:?run_id required}"
CAMPAIGN_ID="${2:?campaign_id required}"
echo "Tip: for readable progress in Cursor, run:" >&2
echo "  node .cursor/aaac/scripts/remediation/remediation-cli.mjs watch --run-id $RUN_ID --campaign-id $CAMPAIGN_ID" >&2
exec node .cursor/aaac/scripts/remediation/remediation-cli.mjs watch \
  --run-id "$RUN_ID" \
  --campaign-id "$CAMPAIGN_ID"
