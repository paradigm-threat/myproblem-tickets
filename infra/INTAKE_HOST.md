# Intake host provision record

| Field | Value |
|-------|--------|
| Cloudspace | `myproblem-intake` |
| Org | paradigmthreat |
| Region | `us-east-iad-1` |
| Public ticket host | `https://intake.myproblem.app` (DNS A → Spot; Caddy LE → `:8787`) |
| SoT | Regional git (`regions/georgia`, `regions/israel`) — **no Neon** |
| Tip disk | hostPath `/var/lib/myproblem-intake/regions` (not emptyDir) |
| Auth | UUID capability; `REQUIRE_TICKET_CLAIM=1` → Bearer/`x-ticket-claim` required |
| Gateway | `relay-gateway` renders tip.json / index.md by UUID path (pending full mount) |
| Commit worker | `workers/intake/server.mjs` (`infra/k8s/intake-bringup.yaml`) |
| TLS | `infra/k8s/intake-caddy.yaml` — certs at hostPath `/var/lib/myproblem-caddy` |
| Batch | Ephemeral `myproblem-batch` / A30 — wake when job files queued |

**Privacy:** UUID capability; no list APIs; close purges unless `preserve`; history trim ~48h; PII converted before commit.
