#!/usr/bin/env bash
# AAAC: block code edits until execute phase. failClosed in hooks.json.
set -euo pipefail
exec node .cursor/aaac/scripts/run-engine/gate-write.mjs
