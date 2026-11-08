#!/usr/bin/env bash
# Mesh history trim (~48h). Call Intake ops endpoint or run locally against regions/.
set -euo pipefail
BASE="${INTAKE_URL:-http://127.0.0.1:8787}"
SECRET="${OPS_WAKE_SECRET:-}"
HDR=()
if [[ -n "$SECRET" ]]; then HDR=(-H "x-ops-secret: $SECRET"); fi
curl -fsS "${HDR[@]}" -X POST "$BASE/api/ops/trim-history" | tee /tmp/trim-history.json
echo
