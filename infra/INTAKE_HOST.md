# Intake host

Public realtime is **Linode Ergo IRC on `pub1.relaygateway.net`** (park `/chat`, Cleverchat IRC bridge). Private / capability-gated ticket intake (`workers/intake/server.mjs` on `:8787`) is a **premium** path hosted on **Linode `pub1`** — not on any cloudspace/Kubernetes cluster.

*(Historical note: the former Rackspace Spot cloudspace `myproblem-intake` in `us-east-iad-1` was deleted 2026-11-26.)*

| Field | Current value |
|-------|---------------|
| Host | Linode **`pub1`** (`pub1.relaygateway.net`, `172.234.148.70`) |
| Public host | `https://intake.myproblem.app` → `pub1` |
| Auth | UUID capability; `REQUIRE_TICKET_CLAIM=1` |
| Commit worker | `workers/intake/server.mjs` (`:8787`) |
| Clevertree Chat host | `pub1` systemd + Caddy (`clevertree-chat` `docs/irc-backbone.md`) |
