#!/usr/bin/env bash
# E2E: ticket-driven local research → KB assessment (searchable ≠ store).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KB="${MYPROBLEM_KB_ROOT:-$(cd "$ROOT/../myproblem-kb" && pwd)}"
export MYPROBLEM_KB_ROOT="$KB"

echo "== KB root: $KB =="
test -d "$KB/.git" || { echo "KB is not a git repo: $KB"; exit 1; }

echo "== unit: kbStore + research assessment =="
cd "$ROOT"
node --test workers/lib/kbStore.test.mjs workers/batch/research-kb-assessment.test.mjs

echo "== live path: research against real KB (example.com cite, fixture comments) =="
# Remove prior E2E slug if present so we demonstrate a fresh write once
SLUG_PATH="georgia/services/home-repair/plumbing/investigations/riverside-drain-decatur-investigation.md"
if [[ "${E2E_KB_FORCE:-}" == "1" ]] && [[ -f "$KB/$SLUG_PATH" ]]; then
  FORCE=--force
else
  FORCE=
fi

OUT=$(node workers/batch/research-kb-assessment.mjs \
  --ticket "e2e-$(date +%s)" \
  --fixture "$ROOT/fixtures/kb/riverside-drain-decatur-reviews.json" \
  --live-cite "https://example.com/" \
  $FORCE)
echo "$OUT" | python3 -c '
import sys,json
d=json.load(sys.stdin)
assert d.get("ok"), d
print("kbHit", d.get("kbHit"))
print("path", d.get("path"))
print("ticketUpdate", d.get("ticketUpdate") or d.get("message"))
live=d.get("live") or {}
if not d.get("kbHit"):
  assert live.get("storedBody") is False
  assert "example.com" in (live.get("url") or "") or live.get("ok")
phone="404-555-0142"
from pathlib import Path
import os
kb=os.environ["MYPROBLEM_KB_ROOT"]
body=Path(kb, d["path"] if not d.get("kbHit") else d["path"]).read_text()
assert phone not in body
print("store_policy_ok")
'

echo "== git log (KB) =="
git -C "$KB" log -3 --oneline

echo "E2E KB research done."
