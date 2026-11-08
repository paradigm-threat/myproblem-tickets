#!/usr/bin/env bash
# Wake ephemeral Batch GPU cloudspace (SJC A30). Called by Intake when bins are ready.
# Prefer MCP/API with SPOT_TOKEN; this script documents the exact shape.
set -euo pipefail

CLOUDSPACE="${BATCH_CLOUDSPACE:-myproblem-batch}"
REGION="${BATCH_REGION:-us-west-sjc-1}"
SERVER_CLASS="${BATCH_SERVER_CLASS:-gpu.vs2.xlargeplusplus-sjc}"
BID="${BATCH_BID_PRICE:-0.15}"
K8S_VERSION="${BATCH_K8S_VERSION:-1.33.0}"
POOL_NAME="${BATCH_POOL_UUID:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"

echo "Wake plan:"
echo "  createCloudspace name=$CLOUDSPACE region=$REGION k8s=$K8S_VERSION"
echo "  createSpotNodePool cloudspace=$CLOUDSPACE name=$POOL_NAME class=$SERVER_CLASS bid=$BID desired=1"
echo "  labels: relay.ai.pool=free_pool relay.ai.asr=on relay.ai.projects=on"
echo ""
echo "Use Rackspace Spot MCP or API with org paradigmthreat. Save POOL_NAME=$POOL_NAME for decommission."
echo "$POOL_NAME" > "$(dirname "$0")/../.last-batch-pool-uuid"
