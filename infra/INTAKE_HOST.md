# Intake host — DECOMMISSIONED

**Status:** Rackspace Spot cloudspace **`myproblem-intake`** was **deleted 2026-11-26**.

Public realtime is **Linode Ergo IRC on `pub1.relaygateway.net`** (park `/chat`, Cleverchat IRC bridge). Private / capability-gated intake is a **premium** path — not hosted on Spot, and not the default public system.

| Field | Former value (historical) |
|-------|--------|
| Cloudspace | `myproblem-intake` (gone) |
| Org | paradigmthreat |
| Region | `us-east-iad-1` |
| Public ticket host | was `https://intake.myproblem.app` → Spot; DNS now follows pub1 / park |
| Auth | UUID capability; `REQUIRE_TICKET_CLAIM=1` |
| Commit worker | `workers/intake/server.mjs` + `infra/k8s/intake-bringup.yaml` |
| Clevertree Chat host | moved off Spot; see clevertree-chat `docs/irc-backbone.md` |

**Do not** run `scripts/deploy-intake.sh` — it exits non-zero and refuses to recreate Spot.

Local kubeconfig `~/.kube/myproblem-intake.yaml` should be removed if present.
