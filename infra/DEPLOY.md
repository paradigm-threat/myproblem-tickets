# Deploy Intake (git SoT, no Neon)

## Ticket path

1. Regional worktrees under `regions/georgia` and `regions/israel` (git commits).
2. Run **commit worker** (`workers/intake/server.mjs`) + **relay-gateway** on `myproblem-intake`.
3. Public DNS: `intake.myproblem.app` → Intake.
4. Vercel `INTAKE_URL=https://intake.myproblem.app` optional multipart bridge only; APK should call Intake directly.
5. Ticket path has **no** database URL — regional git only.

## ConfigMap bring-up

```bash
export KUBECONFIG=~/.kube/myproblem-intake.yaml
bash scripts/deploy-intake.sh
```

Manual equivalent:

```bash
export KUBECONFIG=~/.kube/myproblem-intake.yaml
kubectl -n myproblem create configmap intake-code \
  --from-file=server.mjs=workers/intake/server.mjs \
  --from-file=wake-batch.mjs=workers/intake/wake-batch.mjs \
  --from-file=gitTipStore.mjs=workers/lib/gitTipStore.mjs \
  --from-file=suggestSlug.mjs=workers/lib/suggestSlug.mjs \
  --from-file=bunnyMedia.mjs=workers/lib/bunnyMedia.mjs \
  --from-file=piiConvert.mjs=workers/lib/piiConvert.mjs \
  --from-file=ticketAuth.mjs=workers/lib/ticketAuth.mjs \
  --from-file=asrAttempt.mjs=workers/lib/asrAttempt.mjs \
  --from-file=visionAttempt.mjs=workers/lib/visionAttempt.mjs \
  --from-file=safetyRestraint.mjs=workers/lib/safetyRestraint.mjs \
  --from-file=confidenceGauge.mjs=workers/lib/confidenceGauge.mjs \
  --from-file=package.json=<(echo '{"type":"module","dependencies":{}}') \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f infra/k8s/intake-bringup.yaml
kubectl -n myproblem rollout restart deployment/intake
```

**Persistence:** tip git lives on hostPath `/var/lib/myproblem-intake/regions` (survives Recreate). Cache stays `emptyDir`. ConfigMap must include `ticketAuth.mjs`, `asrAttempt.mjs`, `visionAttempt.mjs`, and `bunnyMedia.mjs`. Each tip repo carries `media-upload.json` (shared Bunny zone + `path_prefix`); sync georgia/israel (and fixit stub when minted) onto the hostPath.

Secrets: `TICKETS_API_SECRET`, `OPS_WAKE_SECRET`, `REQUIRE_TICKET_CLAIM`. Optional `GROQ_API_KEY` enables Whisper and rapid still analysis. `BUNNY_STORAGE_API_KEY` (myproblem-stills storage-zone password) enables (1) private Bunny **inbox** for `kind: video` + `lane: batch` evidence (`inbox_uri` / `bunnyPath` on the tip + `batch_queue.assets`) and (2) Batch `POST /api/tickets/:id/choice-media` public CDN stills (zone/CDN/prefix from repo `media-upload.json` — never put the key in tip git or the APK). Stills on the live path stay cache-only until choice-media; video messages upload to the private inbox on Intake (server-only). Rebuild `intake-secrets` with `kubectl create secret … --dry-run=client -o yaml | kubectl apply -f -` so values are not stored in `last-applied-configuration`. Intake drains its own queue after an upload (`POST /api/ops/process-jobs` remains for ops). Speech is processed before stills. Unused stills and inbox objects are deleted at choice finalize / expire. Without Groq, ASR and vision jobs dry-run and do **not** rename the ticket. Vision model defaults to `qwen/qwen3.8-27b` (`GROQ_VISION_MODEL`). Hazardous problems get a safety warning (`safetyRestraint.mjs`). `confidenceGauge.mjs` scores understanding, then solution confidence. `POST /api/tickets/:id/batch-review` is the batch pass; if unsure, a redacted post is public and a person should continue.

## Retention

- Cron/ops: `POST /api/ops/trim-history` with `x-ops-secret` (~48h mesh history).
- Offline master backup for integrity/anti-fraud only — not on public gateway.

## Gateway

Authorize `myproblem-tickets-georgia` and `myproblem-tickets-israel` in relay-master; mount for exact-path SSR. See Relay `relay-gateway/docs/SERVER_HOOKS.md`.
