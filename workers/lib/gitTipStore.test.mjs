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
  ensureQueuedJob,
  refreshBatchQueue,
  scanQueuedJobs,
  countQueuedByBin,
  lookupTicketIdempotency,
  rememberTicketIdempotency,
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

  it("can create without a public live slug", () => {
    const tip = createTicket("georgia", { mint_slug: false });
    assert.ok(tip.ticket_uuid);
    assert.equal(tip.live_slug, null);
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

  it("keeps a video inbox job queued and lets the live drain skip it", () => {
    const tip = createTicket("georgia");
    enqueueJob("georgia", tip, "media", { evidenceId: "vid", reason: "video-message" });
    ensureQueuedJob("georgia", tip, "project", { reason: "user-text" });
    const all = scanQueuedJobs(100);
    assert.ok(all.some((j) => j.ticket_uuid === tip.ticket_uuid && j.bin === "media"));
    assert.ok(all.some((j) => j.ticket_uuid === tip.ticket_uuid && j.bin === "project"));
    const live = scanQueuedJobs(100, ["media", "project"]);
    assert.equal(
      live.some((j) => j.ticket_uuid === tip.ticket_uuid && j.bin === "media"),
      false,
    );
    assert.equal(
      live.some((j) => j.ticket_uuid === tip.ticket_uuid && j.bin === "project"),
      false,
    );
    const counts = countQueuedByBin();
    assert.ok(counts.media >= 1);
    assert.ok(counts.project >= 1);
  });

  it("snapshots text and inbox media links for the batch queue", () => {
    const tip = createTicket("georgia");
    tip.fields.title = { value: "Flat tire", source: "user", locked: true };
    tip.fields.description = { value: "Passenger side", source: "user", locked: true };
    tip.evidence.push({
      id: "vid1",
      kind: "video",
      uri: "cache://x.mp4",
      inbox_uri: "https://storage.bunnycdn.com/zone/georgia/inbox/tickets/x/vid1.mp4",
      bunnyPath: "georgia/inbox/tickets/x/vid1.mp4",
      lane: "batch",
    });
    ensureQueuedJob("georgia", tip, "project", { reason: "user-text" });
    const loaded = loadTip("georgia", tip.ticket_uuid);
    refreshBatchQueue(loaded);
    assert.equal(loaded.batch_queue.text.title, "Flat tire");
    assert.equal(loaded.batch_queue.assets[0].inbox_uri.includes("/inbox/"), true);
    assert.ok(loaded.batch_queue.jobs.some((j) => j.bin === "project"));
  });

  it("remembers Idempotency-Key → ticket uuid for create replay", () => {
    const key = `client-sub-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    assert.equal(lookupTicketIdempotency("georgia", key), null);
    const tip = createTicket("georgia", {
      mint_slug: false,
      idempotency_key: key,
    });
    assert.equal(lookupTicketIdempotency("georgia", key), tip.ticket_uuid);
    // Same key must not mint a second tip when callers look up first.
    rememberTicketIdempotency("georgia", key, tip.ticket_uuid);
    assert.equal(lookupTicketIdempotency("georgia", key), tip.ticket_uuid);
    assert.equal(lookupTicketIdempotency("georgia", "  " + key + "  "), tip.ticket_uuid);
    assert.equal(lookupTicketIdempotency("georgia", ""), null);
  });
});
