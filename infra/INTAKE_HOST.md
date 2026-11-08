# Intake host provision record

| Field | Value |
|-------|--------|
| Cloudspace | `myproblem-intake` |
| Org | paradigmthreat (`org_wb51srHT8GccEYeV`) |
| Region | `us-east-iad-1` |
| K8s | `1.33.0` |
| Server class | `gp.vs1.large-iad` (4 vCPU / 16 GB) |
| Spot pool UUID | `83d657d7-e491-4b89-b5c1-ef6cf6935399` |
| Bid | `$0.01`/hr (market often lower) |
| Labels | `relay.ai.intake=on` |

Created via Rackspace Spot MCP. Deploy Intake API container/process next; point Vercel `INTAKE_URL` at it when ready.

**Batch** (`myproblem-batch` / A30) is **not** left running — Intake wakes it via `spot-wake-batch.sh` / Spot API when Neon bins are ready, then Batch self-decommissions.
