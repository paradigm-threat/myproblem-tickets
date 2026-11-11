# Deploy Intake (git SoT, no Neon)

## Ticket path

1. Regional worktrees under `regions/georgia` and `regions/israel` (git commits).
2. Run **commit worker** (`workers/intake/server.mjs`) + **relay-gateway** on `myproblem-intake`.
3. Public DNS: `intake.myproblem.app` → Intake.
4. Vercel `INTAKE_URL=https://intake.myproblem.app` optional multipart bridge only; APK should call Intake directly.
5. Ticket path has **no** database URL — regional git only.

## ConfigMap bring-up

```bash
export KUBECONFIG=~/.kube/config   # paradigmthreat-myproblem-intake
kubectl -n myproblem create configmap intake-code \
  --from-file=server.mjs=workers/intake/server.mjs \
  --from-file=wake-batch.mjs=workers/intake/wake-batch.mjs \
  --from-file=gitTipStore.mjs=workers/lib/gitTipStore.mjs \
  --from-file=piiConvert.mjs=workers/lib/piiConvert.mjs \
  --from-file=ticketAuth.mjs=workers/lib/ticketAuth.mjs \
  --from-file=asrAttempt.mjs=workers/lib/asrAttempt.mjs \
  --from-file=visionAttempt.mjs=workers/lib/visionAttempt.mjs \
  --from-file=safetyRestraint.mjs=workers/lib/safetyRestraint.mjs \
  --from-file=confidenceGauge.mjs=workers/lib/confidenceGauge.mjs \
  --from-file=package.json=<(echo '{"type":"module","dependencies":{}}') \
  --dry-run=client -o yaml | kubectl apply -f -
# Also mount regions/ or sync via git clone in the pod (preferred long-term)
kubectl apply -f infra/k8s/intake-bringup.yaml
kubectl -n myproblem rollout restart deployment/intake
```

**Persistence:** tip git lives on hostPath `/var/lib/myproblem-intake/regions` (survives Recreate). Cache stays `emptyDir`. ConfigMap must include `ticketAuth.mjs`, `asrAttempt.mjs`, and `visionAttempt.mjs`.

Secrets: `TICKETS_API_SECRET`, `OPS_WAKE_SECRET`, `REQUIRE_TICKET_CLAIM`. Optional `GROQ_API_KEY` on the Intake secret enables Whisper and rapid still analysis. Intake drains its own queue after an upload (`POST /api/ops/process-jobs` remains for ops). Speech is processed before stills. A still uploaded while audio is still outstanding waits (`VISION` hold default 90s, or until the transcript exists) and is not purged. Without a key, ASR and vision jobs dry-run and do **not** rename the ticket. Vision model defaults to `qwen/qwen3.8-27b` (`GROQ_VISION_MODEL`). The description is the spoken transcript plus every unique frame. Hazardous problems (electrical, gas, fire, medical, structural, and the other cases in `workers/lib/safetyRestraint.mjs`) get a warning that MyProblem does not verify the work is safe. Repair steps are stripped. The warning is reapplied if the ticket is edited and the hazard is still in the text. `confidenceGauge.mjs` scores understanding, then solution confidence. Under the solution threshold the ticket is not advised. `POST /api/tickets/:id/batch-review` is the batch pass; if that pass is also unsure, a redacted post is public and a person should continue.

## Retention

- Cron/ops: `POST /api/ops/trim-history` with `x-ops-secret` (~48h mesh history).
- Offline master backup for integrity/anti-fraud only — not on public gateway.

## Gateway

Authorize `myproblem-tickets-georgia` and `myproblem-tickets-israel` in relay-master; mount for exact-path SSR. See Relay `relay-gateway/docs/SERVER_HOOKS.md`.
