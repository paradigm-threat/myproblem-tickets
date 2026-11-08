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
  --from-file=package.json=<(echo '{"type":"module","dependencies":{}}') \
  --dry-run=client -o yaml | kubectl apply -f -
# Also mount regions/ or sync via git clone in the pod (preferred long-term)
kubectl apply -f infra/k8s/intake-bringup.yaml
kubectl -n myproblem rollout restart deployment/intake
```

**Persistence:** tip git lives on hostPath `/var/lib/myproblem-intake/regions` (survives Recreate). Cache stays `emptyDir`. ConfigMap must include `ticketAuth.mjs`.

Secrets: `TICKETS_API_SECRET`, `OPS_WAKE_SECRET`, `REQUIRE_TICKET_CLAIM` (optional `GROQ_API_KEY`).

## Retention

- Cron/ops: `POST /api/ops/trim-history` with `x-ops-secret` (~48h mesh history).
- Offline master backup for integrity/anti-fraud only — not on public gateway.

## Gateway

Authorize `myproblem-tickets-georgia` and `myproblem-tickets-israel` in relay-master; mount for exact-path SSR. See Relay `relay-gateway/docs/SERVER_HOOKS.md`.
