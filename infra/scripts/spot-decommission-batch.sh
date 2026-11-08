#!/usr/bin/env bash
# Full teardown of myproblem-batch after drain. Intake also reconciles orphans.
set -euo pipefail

CLOUDSPACE="${BATCH_CLOUDSPACE:-myproblem-batch}"
POOL_FILE="$(dirname "$0")/../.last-batch-pool-uuid"
POOL_NAME="${BATCH_POOL_UUID:-}"
if [[ -z "$POOL_NAME" && -f "$POOL_FILE" ]]; then
  POOL_NAME=$(cat "$POOL_FILE")
fi

echo "Decommission plan:"
echo "  deleteSpotNodePool cloudspace=$CLOUDSPACE name=${POOL_NAME:-<uuid>}"
echo "  deleteCloudspace name=$CLOUDSPACE"
echo "Requires SPOT_TOKEN / MCP. Default = delete entirely (not leave desired=0)."
