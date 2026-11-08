# relay-gateway on Intake (render path)

Ticket **mutations** = commit worker (`:8787`). Ticket **render** (HTML / markdown / `tip.json`) = **relay-gateway** serving the regional Relay apps.

## Authorize repos

In `relay-master` catalog, add:

- `myproblem-tickets-georgia` → worktree / bare of `regions/georgia`
- `myproblem-tickets-israel` → `regions/israel`

Exact-path GET only (`hooks/server/get.cs`). No directory listing.

## DNS

Point `intake.myproblem.app` at the Intake node (Caddy/TLS per Relay deploy docs). Path prefixes `/ga/` and `/il/` (or Host rules) select the regional repo.

## Until gateway is wired

Commit worker alone serves JSON API used by the APK. Marketing site remains on Vercel (`myproblem.app`).
