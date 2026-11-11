# myproblem-tickets

Regional Relay app git SoT for MyProblem tips. **No Neon.** Text + media links only.

## Regional repos

| Path | Forge name |
|------|------------|
| [`regions/georgia`](regions/georgia) | `myproblem-tickets-georgia` |
| [`regions/israel`](regions/israel) | `myproblem-tickets-israel` |

Each is a Relay app (`.relay.yaml` + CleverScript hooks). **UUID = access** — no private ticket listing. A human handoff writes `public/<uuid>.json` (redacted, no claim). That board is the only public list.

## Hosts

| Host | Role |
|------|------|
| **Intake** (`myproblem-intake`) | `relay-gateway` renders tip JSON/md; commit worker mutates via git |
| **Batch** (`myproblem-batch`) | Whisper/VL; lease/done = commits in the same regional repo |

Vercel hosts marketing + APK only.

## Layout (per region)

```
.relay.yaml
hooks/server/get.cs          # exact UUID paths only
hooks/server/pre-commit.cs   # reject binaries under tickets/
tickets/<uuid>/tip.json      # preserve, intake, evidence links, confidence
public/<uuid>.json           # redacted human-handoff post only
tickets/<uuid>/index.md
tickets/<uuid>/jobs/<id>.json
```

## Privacy

- Close without `preserve` → purge tip tree
- Mesh history trim ~48h (`POST /api/ops/trim-history`)
- PII auto-conversion before commit — see myproblem `docs/pii-and-privacy.md`

## Local

```bash
npm run intake:serve    # commit worker :8787
npm run wake:check
npm run test:wake
node --test workers/lib/gitTipStore.test.mjs
```

## Deploy

See [`infra/DEPLOY.md`](infra/DEPLOY.md) · [`infra/INTAKE_HOST.md`](infra/INTAKE_HOST.md)
