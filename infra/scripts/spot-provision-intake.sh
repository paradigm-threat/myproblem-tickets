#!/usr/bin/env bash
# Provision always-on Intake CPU cloudspace (IAD).
set -euo pipefail

CLOUDSPACE="${INTAKE_CLOUDSPACE:-myproblem-intake}"
REGION="${INTAKE_REGION:-us-east-iad-1}"
SERVER_CLASS="${INTAKE_SERVER_CLASS:-gp.vs1.large-iad}"
BID="${INTAKE_BID_PRICE:-0.01}"
K8S_VERSION="${INTAKE_K8S_VERSION:-1.33}"
POOL_NAME="${INTAKE_POOL_UUID:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"

echo "Intake provision plan:"
echo "  createCloudspace name=$CLOUDSPACE region=$REGION k8s=$K8S_VERSION"
echo "  createSpotNodePool cloudspace=$CLOUDSPACE name=$POOL_NAME class=$SERVER_CLASS bid=$BID desired=1"
echo "  labels: relay.ai.intake=on"
echo "$POOL_NAME" > "$(dirname "$0")/../.last-intake-pool-uuid"
