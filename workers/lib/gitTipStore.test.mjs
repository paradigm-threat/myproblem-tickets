import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTicket,
  loadTip,
  closeTicket,
  setPreserve,
  enqueueJob,
  scanQueuedJobs,
} from "./gitTipStore.mjs";

describe("gitTipStore", () => {
  it("creates tip in georgia with preserve false", () => {
    const tip = createTicket("georgia");
    assert.ok(tip.ticket_uuid);
    assert.equal(tip.preserve, false);
    assert.equal(tip.region, "georgia");
    const loaded = loadTip("georgia", tip.ticket_uuid);
    assert.equal(loaded.ticket_uuid, tip.ticket_uuid);
  });

  it("purge-on-close unless preserve", () => {
    const tip = createTicket("israel");
    const id = tip.ticket_uuid;
    const purged = closeTicket("israel", id);
    assert.equal(purged.purged, true);
    assert.equal(loadTip("israel", id), null);

    const tip2 = createTicket("israel");
    setPreserve("israel", tip2.ticket_uuid, true);
    const kept = closeTicket("israel", tip2.ticket_uuid);
    assert.equal(kept.purged, false);
    assert.equal(loadTip("israel", tip2.ticket_uuid)?.status, "closed");
  });

  it("enqueues job files scannable ops-locally", () => {
    const tip = createTicket("georgia");
    enqueueJob("georgia", tip, "asr", { evidenceId: "e1" });
    const queued = scanQueuedJobs(100);
    assert.ok(queued.some((j) => j.ticket_uuid === tip.ticket_uuid && j.bin === "asr"));
  });
});
