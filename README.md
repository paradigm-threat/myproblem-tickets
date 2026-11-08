# myproblem-tickets

Server-managed ticket dossier (Relay catalog SoT). Media bytes live in object store; this repo holds tip JSON only.

## Hosts

| Host | Cloudspace | Role |
|------|------------|------|
| **Intake** | `myproblem-intake` (IAD CPU) | Ticket API, light Groq LLM, Neon bins, wake Batch |
| **Batch** | `myproblem-batch` (SJC A30) | Whisper + VL/Project; self-deletes when empty |

See [docs in myproblem](../myproblem/docs/intake-batch-infra.md).

## Layout

```
schema/tip.v1.json       Tip JSON Schema
tickets/<uuid>/tip.json  Live tips (local/dev; fleet uses Relay tip publish)
workers/intake/           Always-on process stubs
workers/batch/           Ephemeral GPU drain + self-decommission
infra/scripts/           Spot wake / destroy helpers
```

## Local tip write

```bash
node workers/intake/write-tip.mjs --id demo --title "Flat tire"
```

## Catalog

Draft record: `../relay/relay-master/catalog/repos/myproblem-tickets.json`  
Register submodule after first push to forge (`add-catalog-submodule.sh`).
