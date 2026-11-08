#!/usr/bin/env bash
# E2E against a running Intake server (default localhost:8787)
set -euo pipefail
BASE="${INTAKE_URL:-http://127.0.0.1:8787}"
SECRET="${TICKETS_API_SECRET:-}"
OPS="${OPS_WAKE_SECRET:-}"
HDR=(-H "content-type: application/json")
if [[ -n "$SECRET" ]]; then
  HDR+=(-H "x-tickets-secret: $SECRET")
fi
OPS_HDR=()
if [[ -n "$OPS" ]]; then
  OPS_HDR=(-H "x-ops-secret: $OPS")
elif [[ -n "$SECRET" ]]; then
  OPS_HDR=(-H "x-tickets-secret: $SECRET")
fi

echo "== health =="
curl -fsS "$BASE/health" | tee /tmp/intake-health.json
echo

echo "== create ticket =="
CREATE=$(curl -fsS "${HDR[@]}" -X POST "$BASE/api/tickets")
echo "$CREATE" | tee /tmp/intake-create.json
UUID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/intake-create.json','utf8')).ticket_uuid)")
CLAIM=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/intake-create.json','utf8')).claim)")
echo "uuid=$UUID"

echo "== get with claim =="
curl -fsS -H "authorization: Bearer $CLAIM" "$BASE/api/tickets/$UUID" | tee /tmp/intake-get.json >/dev/null
echo ok

echo "== evidence audio final =="
AUDIO_B64=$(echo -n "fake-audio-bytes" | base64 -w0)
curl -fsS -H "authorization: Bearer $CLAIM" -H "content-type: application/json" \
  -d "{\"kind\":\"audio\",\"base64\":\"$AUDIO_B64\",\"isFinal\":true,\"transcript\":\"I have a flat tire on the roadside. Spare is in the trunk.\"}" \
  "$BASE/api/tickets/$UUID/evidence" | tee /tmp/intake-ev.json >/dev/null
echo ok

echo "== wake check =="
curl -fsS "${OPS_HDR[@]}" "$BASE/api/ops/wake-batch" | tee /tmp/intake-wake.json
echo

echo "== unauthorized without claim (expect 401 if REQUIRE_TICKET_CLAIM=1) =="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tickets/$UUID" || true)
echo "status=$CODE"

echo "E2E done."
