import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTicket,
  loadTip,
  closeTicket,
  setPreserve,
  setTipResolution,
  resolveLiveSlug,
  enqueueJob,
  scanQueuedJobs,
} from "./gitTipStore.mjs";

describe("gitTipStore", () => {
  it("creates tip in georgia with preserve false", () => {
    const tip = createTicket("georgia");
    assert.ok(tip.ticket_uuid);
    assert.ok(tip.claim && tip.claim.length >= 32);
    assert.equal(tip.preserve, false);
    assert.equal(tip.region, "georgia");
    assert.equal(tip.resolution, "unsolved");
    assert.ok(tip.live_slug && tip.live_slug.length >= 4);
    const resolved = resolveLiveSlug(tip.live_slug);
    assert.equal(resolved?.ticket_uuid, tip.ticket_uuid);
    const loaded = loadTip("georgia", tip.ticket_uuid);
    assert.equal(loaded.ticket_uuid, tip.ticket_uuid);
    assert.equal(loaded.claim, tip.claim);
  });

  it("drops live slug when SI marks solved", () => {
    const tip = createTicket("georgia");
    const slug = tip.live_slug;
    setTipResolution("georgia", tip.ticket_uuid, "solved");
    assert.equal(resolveLiveSlug(slug), null);
    assert.equal(loadTip("georgia", tip.ticket_uuid)?.resolution, "solved");
    assert.equal(loadTip("georgia", tip.ticket_uuid)?.live_slug, null);
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
