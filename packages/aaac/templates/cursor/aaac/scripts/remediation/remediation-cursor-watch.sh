#!/usr/bin/env bash
# Launch remediation watch via Cursor CLI (foreground, monitorable).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
RUN_ID="${1:?run_id required}"
CAMPAIGN_ID="${2:?campaign_id required}"
exec node .cursor/aaac/scripts/remediation/remediation-cli.mjs cursor \
  --run-id "$RUN_ID" \
  --campaign-id "$CAMPAIGN_ID"
