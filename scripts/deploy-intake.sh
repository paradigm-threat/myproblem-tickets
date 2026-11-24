#!/usr/bin/env bash
# Pack Intake worker modules into the live ConfigMap and restart intake.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KUBECONFIG="${KUBECONFIG:-$HOME/.kube/myproblem-intake.yaml}"
export KUBECONFIG

kubectl -n myproblem create configmap intake-code \
  --from-file=server.mjs="$ROOT/workers/intake/server.mjs" \
  --from-file=wake-batch.mjs="$ROOT/workers/intake/wake-batch.mjs" \
  --from-file=gitTipStore.mjs="$ROOT/workers/lib/gitTipStore.mjs" \
  --from-file=suggestSlug.mjs="$ROOT/workers/lib/suggestSlug.mjs" \
  --from-file=bunnyMedia.mjs="$ROOT/workers/lib/bunnyMedia.mjs" \
  --from-file=piiConvert.mjs="$ROOT/workers/lib/piiConvert.mjs" \
  --from-file=ticketAuth.mjs="$ROOT/workers/lib/ticketAuth.mjs" \
  --from-file=asrAttempt.mjs="$ROOT/workers/lib/asrAttempt.mjs" \
  --from-file=visionAttempt.mjs="$ROOT/workers/lib/visionAttempt.mjs" \
  --from-file=safetyRestraint.mjs="$ROOT/workers/lib/safetyRestraint.mjs" \
  --from-file=confidenceGauge.mjs="$ROOT/workers/lib/confidenceGauge.mjs" \
  --from-file=package.json=<(echo '{"type":"module","dependencies":{}}') \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f "$ROOT/infra/k8s/intake-bringup.yaml"
kubectl -n myproblem rollout restart deployment/intake
kubectl -n myproblem rollout status deployment/intake --timeout=180s
echo "Smoke: https://intake.myproblem.app/healthz (or /api/health)"
