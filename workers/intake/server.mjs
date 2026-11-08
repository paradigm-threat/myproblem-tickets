#!/usr/bin/env node
/**
 * Intake commit worker — mutations via regional git commits.
 * Render is relay-gateway; this process accepts create/evidence/close/ops.
 * UUID = capability (no public list). No Neon.
 */
import { createServer } from "node:http";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateWake } from "./wake-batch.mjs";
import {
  REGIONS,
  createTicket,
  loadTip,
  loadTipAnyRegion,
  saveTip,
  enqueueJob,
  setJobState,
  closeTicket,
  setPreserve,
  scanQueuedJobs,
  trimHistory,
} from "../lib/gitTipStore.mjs";
import { scrubTipPii, convertPii } from "../lib/piiConvert.mjs";
import { authorizeTicket } from "../lib/ticketAuth.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE = process.env.TICKETS_CACHE_DIR || join(ROOT, ".data", "cache");
const PORT = Number(process.env.PORT || 8787);

function cacheWrite(ticketId, evidenceId, buf, ext) {
  const dir = join(CACHE, ticketId);
  mkdirSync(dir, { recursive: true });
  const name = `${evidenceId}${ext}`;
  const fp = join(dir, name);
  writeFileSync(fp, buf);
  return { path: fp, uri: `cache://${ticketId}/${name}` };
}

function resolveCache(uri) {
  if (!uri?.startsWith("cache://")) return null;
  const fp = join(CACHE, uri.slice("cache://".length));
  return existsSync(fp) ? fp : null;
}

function purgeUri(uri) {
  const fp = resolveCache(uri);
  if (fp) {
    try {
      unlinkSync(fp);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function hasApiSecret(req) {
  const secret = process.env.TICKETS_API_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const hdr = req.headers["x-tickets-secret"] || bearer;
  return Boolean(hdr && safeEqual(String(hdr), secret));
}

function hasOpsSecret(req) {
  const secret = process.env.OPS_WAKE_SECRET?.trim();
  if (!secret) return hasApiSecret(req);
  const hdr = req.headers["x-ops-secret"] || "";
  return Boolean(hdr && safeEqual(String(hdr), secret));
}

/** UUID = access; when REQUIRE_TICKET_CLAIM=1, claim is required (API secret bypasses). */
function authorize(req, tip) {
  return authorizeTicket(req, tip, { hasApiSecret: hasApiSecret(req) });
}

function denyUnlessAuthorized(req, res, tip) {
  if (!authorize(req, tip)) {
    json(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      "authorization, content-type, x-tickets-secret, x-ticket-claim, x-ops-secret, x-region",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  });
  res.end(body);
}

function parseRegion(raw) {
  const r = String(raw || "georgia").toLowerCase();
  return REGIONS.includes(r) ? r : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return json(res, 204, {});
  }

  if (path === "/health") {
    return json(res, 200, { ok: true, service: "myproblem-intake", sot: "git-regional", ts: Date.now() });
  }

  // Forbidden: list tickets
  if (path === "/api/tickets" && req.method === "GET") {
    return json(res, 404, { error: "not_found" });
  }
  if (path === "/api/tickets/" || path === "/tickets" || path === "/tickets/") {
    return json(res, 404, { error: "not_found" });
  }

  if (req.method === "POST" && path === "/api/tickets") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const region = parseRegion(body.region || req.headers["x-region"]);
    if (!region) return json(res, 400, { error: "invalid_region", regions: REGIONS });
    const tip = createTicket(region);
    return json(res, 200, {
      ticket_uuid: tip.ticket_uuid,
      claim: tip.claim,
      region,
      tip,
    });
  }

  const tipMatch = path.match(/^\/api\/tickets\/([^/]+)$/);
  if (tipMatch) {
    const id = tipMatch[1];
    const found = loadTipAnyRegion(id);
    if (!found) return json(res, 404, { error: "not_found" });
    const { tip, region } = found;
    if (!denyUnlessAuthorized(req, res, tip)) return;

    if (req.method === "GET") {
      // Honest intake from job files
      const hasTx = tip.evidence.some((e) => e.kind === "transcript" && e.text);
      const asrQueued = tip.jobs.some((j) => j.bin === "asr" && j.state === "queued");
      const asrLeased = tip.jobs.some((j) => j.bin === "asr" && j.state === "leased");
      const audioPending = tip.evidence.some((e) => e.kind === "audio" && !e.processed && e.uri);
      const before = tip.intake;
      const now = Date.now();
      const started = tip.updatedAtMs || tip.createdAtMs || now;
      if (hasTx && (tip.intake === "transcribing" || tip.intake === "queued" || tip.intake === "timeout")) {
        tip.intake = "named_and_questions";
      } else if (asrLeased) {
        tip.intake =
          now - started > 10 * 60 * 1000 ? "timeout" : "transcribing";
        tip.coachLine = tip.intake === "timeout" ? "Transcription stalled — retry." : "Transcribing…";
      } else if (asrQueued || audioPending || tip.intake === "transcribing" || tip.intake === "queued") {
        tip.intake = now - started > 30 * 60 * 1000 ? "timeout" : "queued";
        tip.coachLine =
          tip.intake === "timeout"
            ? "Timed out waiting for Batch — retry sync or re-upload."
            : "Queued for transcription — waiting for Batch…";
      }
      if (tip.intake !== before) saveTip(region, scrubTipPii(tip), "honest-intake");
      return json(res, 200, tip);
    }

    if (req.method === "PATCH") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (typeof body.title === "string" && body.title.trim()) {
        tip.fields.title = {
          value: convertPii(body.title.trim()).text,
          source: "user",
          locked: true,
        };
      }
      if (typeof body.description === "string") {
        tip.fields.description = {
          value: convertPii(body.description).text,
          source: "user",
          locked: true,
        };
      }
      if (typeof body.preserve === "boolean") tip.preserve = body.preserve;
      tip.timeline.push({
        id: randomUUID(),
        kind: "user_text",
        body: "Title/description locked by you",
        atMs: Date.now(),
      });
      tip.intake = "figuring_out";
      tip.coachLine = "Figuring out…";
      scrubTipPii(tip);
      saveTip(region, tip, "user-lock");
      return json(res, 200, tip);
    }
  }

  const preserveMatch = path.match(/^\/api\/tickets\/([^/]+)\/preserve$/);
  if (preserveMatch && req.method === "POST") {
    const id = preserveMatch[1];
    const found = loadTipAnyRegion(id);
    if (!found) return json(res, 404, { error: "not_found" });
    if (!denyUnlessAuthorized(req, res, found.tip)) return;
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const tip = setPreserve(found.region, id, body.preserve !== false);
    return json(res, 200, tip);
  }

  const reprocessMatch = path.match(/^\/api\/tickets\/([^/]+)\/reprocess$/);
  if (reprocessMatch && req.method === "POST") {
    const id = reprocessMatch[1];
    const found = loadTipAnyRegion(id);
    if (!found) return json(res, 404, { error: "not_found" });
    if (!denyUnlessAuthorized(req, res, found.tip)) return;
    let { tip, region } = found;
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const delta = body.contextDelta || {};
    const names = Array.isArray(delta.addedNames) ? delta.addedNames : [];
    const note = typeof delta.newUserNote === "string" ? delta.newUserNote : "";
    const hasContext = names.length > 0 || Boolean(note.trim()) || delta.titleChanged === true;
    if (!hasContext) {
      return json(res, 200, {
        ok: false,
        action: "skipped",
        gate: { reason: "no_new_context", needsReupload: false, hotwords: [] },
      });
    }
    const hotwords = names.map(String).filter(Boolean);
    tip.intake = "queued";
    tip.coachLine = "Queued for reprocess — waiting for Batch…";
    tip.timeline.push({
      id: randomUUID(),
      kind: "system",
      body: convertPii(`Reprocess requested (${body.requestedBy || "user"})`).text,
      atMs: Date.now(),
    });
    const bin = body.target === "vision" ? "vision" : "asr";
    const kind = bin === "vision" ? "still" : "audio";
    // Prefer evidence with a live cache URI. After Batch, uris are purged —
    // do not enqueue a doomed job; client re-uploads with hotwords.
    const liveEv =
      tip.evidence.filter((e) => e.kind === kind && e.uri && resolveCache(e.uri)).at(-1) ||
      (body.evidenceId
        ? tip.evidence.find((e) => e.id === body.evidenceId && e.uri && resolveCache(e.uri))
        : null);
    if (!liveEv) {
      tip.pendingReprocess = { bin, hotwords, atMs: Date.now() };
      scrubTipPii(tip);
      saveTip(region, tip, "reprocess-await-upload");
      return json(res, 200, {
        ok: true,
        action: "awaiting_upload",
        gate: { reason: "new_context", needsReupload: true, hotwords },
      });
    }
    const job = enqueueJob(region, tip, bin, {
      evidenceId: body.evidenceId || liveEv.id,
      hotwords,
      reason: "reprocess",
    });
    return json(res, 200, {
      ok: true,
      action: "enqueued",
      jobId: job.id,
      gate: { reason: "new_context", needsReupload: false, hotwords },
    });
  }

  const closeMatch = path.match(/^\/api\/tickets\/([^/]+)\/close$/);
  if (closeMatch && req.method === "POST") {
    const id = closeMatch[1];
    const found = loadTipAnyRegion(id);
    if (!found) return json(res, 404, { error: "not_found" });
    if (!denyUnlessAuthorized(req, res, found.tip)) return;
    // Purge linked cache media when deleting
    if (!found.tip.preserve) {
      for (const ev of found.tip.evidence || []) {
        if (ev.uri) purgeUri(ev.uri);
      }
    }
    const result = closeTicket(found.region, id);
    return json(res, 200, result);
  }

  const evMatch = path.match(/^\/api\/tickets\/([^/]+)\/evidence$/);
  if (evMatch && req.method === "POST") {
    const id = evMatch[1];
    const found = loadTipAnyRegion(id);
    if (!found) return json(res, 404, { error: "not_found" });
    if (!denyUnlessAuthorized(req, res, found.tip)) return;
    let { tip, region } = found;
    const ct = req.headers["content-type"] || "";
    const raw = await readBody(req);
    if (!ct.includes("application/json")) {
      return json(res, 400, { error: "expected_json_base64" });
    }
    const body = JSON.parse(raw.toString("utf8") || "{}");
    if (body.kind === "video") return json(res, 400, { error: "video_rejected" });
    const buf = Buffer.from(body.base64 || "", "base64");
    const evidenceId = randomUUID();
    const hash = createHash("sha256").update(buf).digest("hex");

    if (body.kind === "audio") {
      const { uri } = cacheWrite(id, evidenceId, buf, ".bin");
      tip.evidence.push({
        id: evidenceId,
        kind: "audio",
        uri,
        sha256: hash,
        chunkIndex: body.chunkIndex ?? null,
        isFinal: Boolean(body.isFinal),
        atMs: Date.now(),
        processed: false,
      });
      if (body.isFinal || body.chunkIndex == null) {
        tip.timeline.push({
          id: randomUUID(),
          kind: "user_audio",
          body: "Final audio attached (ephemeral cache)",
          atMs: Date.now(),
        });
        tip.intake = "queued";
        tip.coachLine = "Queued for transcription — waiting for Batch…";
        const pending = tip.pendingReprocess?.bin === "asr" ? tip.pendingReprocess : null;
        const hotwords = body.hotwords?.length ? body.hotwords : pending?.hotwords || [];
        if (pending) delete tip.pendingReprocess;
        enqueueJob(region, tip, "asr", { evidenceId, hotwords, reason: pending ? "reprocess" : "upload" });
        tip = loadTip(region, id);
      } else {
        saveTip(region, tip, "audio-chunk");
      }
      return json(res, 200, { ok: true, evidenceId, tip });
    }

    if (body.kind === "still") {
      const { uri } = cacheWrite(id, evidenceId, buf, ".jpg");
      tip.evidence.push({
        id: evidenceId,
        kind: "still",
        uri,
        sha256: hash,
        atMs: Date.now(),
        processed: false,
      });
      tip.timeline.push({
        id: randomUUID(),
        kind: "user_still",
        body: "Still cached for Batch vision",
        atMs: Date.now(),
      });
      const pending = tip.pendingReprocess?.bin === "vision" ? tip.pendingReprocess : null;
      if (pending) delete tip.pendingReprocess;
      enqueueJob(region, tip, "vision", { evidenceId, reason: pending ? "reprocess" : "upload" });
      tip = loadTip(region, id);
      return json(res, 200, { ok: true, evidenceId, tip });
    }
    return json(res, 400, { error: "unknown_kind" });
  }

  if (path === "/api/ops/wake-batch" && (req.method === "GET" || req.method === "POST")) {
    if (!hasOpsSecret(req) && process.env.OPS_WAKE_SECRET) {
      return json(res, 401, { error: "unauthorized" });
    }
    const decision = await evaluateWake();
    return json(res, 200, decision);
  }

  if (path === "/api/ops/trim-history" && req.method === "POST") {
    if (!hasOpsSecret(req) && process.env.OPS_WAKE_SECRET) {
      return json(res, 401, { error: "unauthorized" });
    }
    const results = {};
    for (const r of REGIONS) results[r] = trimHistory(r);
    return json(res, 200, { ok: true, results });
  }

  if (path === "/api/ops/process-jobs" && req.method === "POST") {
    if (!hasOpsSecret(req) && process.env.OPS_WAKE_SECRET) {
      return json(res, 401, { error: "unauthorized" });
    }
    const queued = scanQueuedJobs(Number(url.searchParams.get("limit") || 10));
    const results = [];
    for (const job of queued) {
      const tip = loadTip(job.region, job.ticket_uuid);
      if (!tip) {
        results.push({ id: job.id, error: "tip_missing" });
        continue;
      }
      const evidenceId = job.payload?.evidenceId;
      const ev =
        tip.evidence.find((e) => e.id === evidenceId) ||
        tip.evidence.filter((e) => e.kind === (job.bin === "asr" ? "audio" : "still")).at(-1);
      if (!ev?.uri) {
        setJobState(job.region, tip, job.id, "error");
        results.push({ id: job.id, error: "no_cache_uri" });
        continue;
      }
      const fp = resolveCache(ev.uri);
      if (!fp) {
        setJobState(job.region, tip, job.id, "error");
        results.push({ id: job.id, error: "cache_missing" });
        continue;
      }
      tip.intake = job.bin === "asr" ? "transcribing" : "investigating";
      tip.coachLine = job.bin === "asr" ? "Transcribing…" : "Processing still…";
      setJobState(job.region, tip, job.id, "leased");

      let text = `[dry-run] ${fp.split("/").pop()}`;
      let model = "dry-run";
      if (job.bin === "asr" && process.env.GROQ_API_KEY) {
        try {
          const form = new FormData();
          form.append("file", new Blob([readFileSync(fp)]), "audio.wav");
          form.append("model", process.env.GROQ_WHISPER_MODEL || "whisper-large-v3");
          form.append("language", "en");
          form.append("response_format", "json");
          const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            body: form,
          });
          if (r.ok) {
            const j = await r.json();
            text = j.text || text;
            model = "whisper-large-v3";
          }
        } catch {
          text = `${text} (groq_error)`;
        }
      }
      text = convertPii(text).text;
      tip.evidence.push({
        id: randomUUID(),
        kind: job.bin === "asr" ? "transcript" : "text",
        uri: "",
        text,
        model,
        atMs: Date.now(),
        audioEvidenceId: ev.id,
      });
      if (job.bin === "asr") {
        if (!tip.fields.title.locked && text.length > 8) {
          tip.fields.title = {
            value: convertPii(text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 120)).text,
            source: "intake",
            locked: false,
          };
        }
        if (!tip.fields.description.locked) {
          tip.fields.description = {
            value: convertPii(text.slice(0, 800)).text,
            source: "intake",
            locked: false,
          };
        }
        tip.intake = "named_and_questions";
        tip.coachLine = "Got a transcript — review or add a still.";
      }
      purgeUri(ev.uri);
      ev.uri = "";
      ev.processed = true;
      ev.purgedAtMs = Date.now();
      scrubTipPii(tip);
      setJobState(job.region, tip, job.id, "done");
      results.push({ id: job.id, ok: true, model, textPreview: text.slice(0, 120) });
    }
    return json(res, 200, { processed: results.filter((r) => r.ok).length, results });
  }

  return json(res, 404, { error: "not_found" });
});

server.listen(PORT, () => {
  console.log(`myproblem-intake git SoT on :${PORT} regions=${REGIONS.join(",")}`);
});
