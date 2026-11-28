# Deploy Intake (git SoT, no Neon)

## Ticket path

1. Regional worktrees under `/var/lib/myproblem-intake/regions/georgia` and `israel` (git commits) on Linode **`pub1`** (`pub1.relaygateway.net`).
2. Run **commit worker** (`workers/intake/server.mjs` on `:8787`) + **relay-gateway** on `pub1`.
3. Public DNS: `intake.myproblem.app` → `pub1` (`172.234.148.70`).
4. Vercel `INTAKE_URL=https://intake.myproblem.app` optional multipart bridge only; APK calls Intake directly.
5. Ticket path has **no** database URL — regional git only.

## Host setup (Linode `pub1`)

- Persist regional git tips under `/var/lib/myproblem-intake/regions` (survives service restarts). Cache stays ephemeral.
- Each tip repo carries `media-upload.json` (shared Bunny zone + `path_prefix`).
- Required env/secrets: `TICKETS_API_SECRET`, `OPS_WAKE_SECRET`, `REQUIRE_TICKET_CLAIM`.
- Optional `GROQ_API_KEY` enables Whisper and rapid still analysis (providers-only AI — see MyProblem [`docs/providers-ai.md`](../../myproblem/docs/providers-ai.md)). Prefer logging **$/request** when calls succeed.
- `BUNNY_STORAGE_API_KEY` (`myproblem-stills` storage-zone password) enables (1) private Bunny **inbox** for `kind: video` + `lane: batch` evidence (`inbox_uri` / `bunnyPath` on the tip + `batch_queue.assets`) and (2) Batch `POST /api/tickets/:id/choice-media` public CDN stills (zone/CDN/prefix from repo `media-upload.json` — never put the key in tip git or the APK).
- Stills on the live path stay cache-only until choice-media; video messages upload to the private inbox on Intake (server-only).
- Intake drains its own queue after an upload (`POST /api/ops/process-jobs` remains for ops). Speech is processed before stills. Unused stills and inbox objects are deleted at choice finalize / expire. Without Groq, ASR and vision jobs dry-run and do **not** rename the ticket. Vision model defaults to `qwen/qwen3.8-27b` (`GROQ_VISION_MODEL`). Hazardous problems get a safety warning (`safetyRestraint.mjs`). `confidenceGauge.mjs` scores understanding, then solution confidence. `POST /api/tickets/:id/batch-review` is the batch pass; if unsure, a redacted post is public and a person should continue.

## Retention

- Cron/ops: `POST /api/ops/trim-history` with `x-ops-secret` (~48h mesh history).
- Offline master backup for integrity/anti-fraud only — not on public gateway.

## Gateway

Authorize `myproblem-tickets-georgia` and `myproblem-tickets-israel` in `relay-master`; mount for exact-path SSR. See `relay-gateway/docs/SERVER_HOOKS.md`.
