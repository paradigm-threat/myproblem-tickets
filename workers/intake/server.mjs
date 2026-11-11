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
  savePublicPost,
  loadPublicPost,
  listPublicPosts,
  removePublicPost,
} from "../lib/gitTipStore.mjs";
import { scrubTipPii, convertPii } from "../lib/piiConvert.mjs";
import { authorizeTicket } from "../lib/ticketAuth.mjs";
import { classifyAsrAttempt } from "../lib/asrAttempt.mjs";
import { applySafetyRestraint } from "../lib/safetyRestraint.mjs";
import { applyBatchReview, applyConfidence, noteRollingClip, toPublicPost } from "../lib/confidenceGauge.mjs";
import {
  chatContent,
  classifyVisionAttempt,
  absorbNewerTip,
  composeTicketDescription,
  evidenceTexts,
  latestEvidenceText,
  mergeQuestions,
  parseVisionReply,
  shouldDeferVision,
  visionPrompt,
} from "../lib/visionAttempt.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CACHE = process.env.TICKETS_CACHE_DIR || join(ROOT, ".data", "cache");
const PORT = Number(process.env.PORT || 8787);

let drainChain = Promise.resolve();
let holdTimer = null;

/** Run queued ASR, then stills, without an operator calling process-jobs. */
function scheduleDrain(delayMs = 0) {
  if (delayMs > 0) {
    if (holdTimer) return;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      scheduleDrain(0);
    }, delayMs);
    if (typeof holdTimer.unref === "function") holdTimer.unref();
    return;
  }
  const secret = process.env.OPS_WAKE_SECRET?.trim();
  drainChain = drainChain
    .then(() =>
      fetch(`http://127.0.0.1:${PORT}/api/ops/process-jobs?limit=4`, {
        method: "POST",
        headers: secret ? { "x-ops-secret": secret } : {},
      }).then((r) => {
        if (!r.ok) console.error("drain_status", r.status);
      }),
    )
    .catch((err) => {
      console.error("drain_error", err?.message || "drain");
    });
}

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

const MAX_BODY_BYTES = Number(process.env.INTAKE_MAX_BODY_BYTES || 8 * 1024 * 1024);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (c) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        const err = new Error("body_too_large");
        err.code = "body_too_large";
        reject(err);
        return;
      }
      chunks.push(c);
    });
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

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (res.headersSent) return;
    if (err?.code === "body_too_large") return json(res, 413, { error: "body_too_large" });
    console.error("intake_error", err?.code || err?.message || "internal");
    return json(res, 500, { error: "internal" });
  });
});

async function handle(req, res) {
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
      const hasRealTx = tip.evidence.some(
        (e) =>
          e.kind === "transcript" &&
          e.text &&
          e.model !== "dry-run" &&
          !String(e.text).startsWith("[dry-run]"),
      );
      const asrQueued = tip.jobs.some((j) => j.bin === "asr" && j.state === "queued");
      const asrLeased = tip.jobs.some((j) => j.bin === "asr" && j.state === "leased");
      const asrError = tip.jobs.some((j) => j.bin === "asr" && j.state === "error");
      const audioPending = tip.evidence.some((e) => e.kind === "audio" && !e.processed && e.uri);
      const before = tip.intake;
      const safetyCoach =
        tip.safety?.warned && String(tip.coachLine || "").startsWith("Safety warning");
      const now = Date.now();
      const started = tip.updatedAtMs || tip.createdAtMs || now;
      const dryTxOnly =
        !hasRealTx &&
        tip.evidence.some(
          (e) => e.kind === "transcript" && (e.model === "dry-run" || String(e.text || "").startsWith("[dry-run]")),
        );
      if (hasRealTx && (tip.intake === "transcribing" || tip.intake === "queued" || tip.intake === "timeout")) {
        tip.intake = "named_and_questions";
      } else if (asrLeased) {
        tip.intake =
          now - started > 10 * 60 * 1000 ? "timeout" : "transcribing";
        if (!safetyCoach) {
          tip.coachLine = tip.intake === "timeout" ? "Transcription stalled — retry." : "Transcribing…";
        }
      } else if (asrError && !asrQueued && !hasRealTx) {
        tip.intake = "queued";
        if (!safetyCoach) tip.coachLine = "Transcription failed — audio kept for retry.";
      } else if (dryTxOnly) {
        // Already processed without GROQ — do not pretend we are still queued.
        tip.intake = "queued";
        if (!safetyCoach) {
          tip.coachLine =
            tip.coachLine?.includes("GROQ") || tip.coachLine?.includes("dry-run")
              ? tip.coachLine
              : "ASR dry-run (set GROQ_API_KEY for Whisper) — waiting for real Batch…";
        }
      } else if (asrQueued || audioPending || tip.intake === "transcribing") {
        tip.intake = now - started > 30 * 60 * 1000 ? "timeout" : "queued";
        if (!safetyCoach) {
          tip.coachLine =
            tip.intake === "timeout"
              ? "Timed out waiting for Batch — retry sync or re-upload."
              : "Queued for transcription — waiting for Batch…";
        }
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
      applySafetyRestraint(tip);
      applyConfidence(tip);
      if (tip.confidence?.public !== true) removePublicPost(region, tip.ticket_uuid);
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
    scheduleDrain();
    return json(res, 200, {
      ok: true,
      action: "enqueued",
      jobId: job.id,
      gate: { reason: "new_context", needsReupload: false, hotwords },
    });
  }

  const batchMatch = path.match(/^\/api\/tickets\/([^/]+)\/batch-review$/);
  if (batchMatch && req.method === "POST") {
    const id = batchMatch[1];
    const found = loadTipAnyRegion(id);
    if (!found) return json(res, 404, { error: "not_found" });
    if (!denyUnlessAuthorized(req, res, found.tip)) return;
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const gauge = applyBatchReview(found.tip, { kbHit: body.kbHit === true });
    if (gauge.public) savePublicPost(found.region, toPublicPost(found.tip));
    else removePublicPost(found.region, id);
    scrubTipPii(found.tip);
    saveTip(found.region, found.tip, gauge.public ? "public-handoff" : "batch-review");
    return json(res, 200, { confidence: found.tip.confidence, coachLine: found.tip.coachLine });
  }

  if (path === "/api/public/posts" && req.method === "GET") {
    return json(res, 200, { posts: listPublicPosts() });
  }
  const publicMatch = path.match(/^\/api\/public\/posts\/([^/]+)$/);
  if (publicMatch && req.method === "GET") {
    const post = loadPublicPost(publicMatch[1]);
    if (!post) return json(res, 404, { error: "not_found" });
    return json(res, 200, post);
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
      const rolling = body.rolling === true;
      if (body.isFinal || body.chunkIndex == null || rolling) {
        tip.timeline.push({
          id: randomUUID(),
          kind: "user_audio",
          body: rolling ? "Rolling audio clip" : "Final audio attached (ephemeral cache)",
          atMs: Date.now(),
        });
        if (rolling) {
          noteRollingClip(tip);
        } else {
          tip.intake = "queued";
          if (!String(tip.coachLine || "").startsWith("Safety warning")) {
            tip.coachLine = "Queued for transcription — waiting for Batch…";
          }
        }
        const pending = tip.pendingReprocess?.bin === "asr" ? tip.pendingReprocess : null;
        const hotwords = body.hotwords?.length ? body.hotwords : pending?.hotwords || [];
        if (pending) delete tip.pendingReprocess;
        enqueueJob(region, tip, "asr", {
          evidenceId,
          hotwords,
          reason: rolling ? "rolling" : pending ? "reprocess" : "upload",
        });
        tip = loadTip(region, id);
        scheduleDrain();
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
      scheduleDrain();
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
    const rank = { asr: 0, vision: 1, project: 2, intake: 3 };
    queued.sort((a, b) => (rank[a.bin] ?? 9) - (rank[b.bin] ?? 9));
    const results = [];
    for (const job of queued) {
      const tip = loadTip(job.region, job.ticket_uuid);
      if (!tip) {
        results.push({ id: job.id, error: "tip_missing" });
        continue;
      }
      if (job.bin === "vision" && shouldDeferVision(tip)) {
        const coach = "Holding the still until the recording is transcribed.";
        if (tip.coachLine !== coach) {
          tip.coachLine = coach;
          if (tip.intake === "investigating") tip.intake = "queued";
          saveTip(job.region, tip, "vision-hold");
        }
        results.push({ id: job.id, deferred: "wait_for_speech" });
        continue;
      }
      const evidenceId = job.payload?.evidenceId;
      const ev =
        tip.evidence.find((e) => e.id === evidenceId) ||
        tip.evidence.filter((e) => e.kind === (job.bin === "asr" ? "audio" : "still")).at(-1);
      if (!ev?.uri) {
        absorbNewerTip(tip, loadTip(job.region, job.ticket_uuid));
        setJobState(job.region, tip, job.id, "error");
        results.push({ id: job.id, error: "no_cache_uri" });
        continue;
      }
      const fp = resolveCache(ev.uri);
      if (!fp) {
        absorbNewerTip(tip, loadTip(job.region, job.ticket_uuid));
        setJobState(job.region, tip, job.id, "error");
        results.push({ id: job.id, error: "cache_missing" });
        continue;
      }
      absorbNewerTip(tip, loadTip(job.region, job.ticket_uuid));
      tip.intake = job.bin === "asr" ? "transcribing" : "investigating";
      tip.coachLine = job.bin === "asr" ? "Transcribing…" : "Processing still…";
      setJobState(job.region, tip, job.id, "leased");

      const whisperModel = process.env.GROQ_WHISPER_MODEL || "whisper-large-v3";
      const visionModel = process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";
      let text = `[dry-run] ${fp.split("/").pop()}`;
      let model = "dry-run";
      let mediaFail = null;
      let visionQuestion = "";
      if (job.bin === "asr") {
        let attempt = classifyAsrAttempt({ hasKey: false });
        if (process.env.GROQ_API_KEY) {
          try {
            const form = new FormData();
            form.append("file", new Blob([readFileSync(fp)]), "audio.wav");
            form.append("model", whisperModel);
            form.append("language", "en");
            form.append("response_format", "json");
            const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
              method: "POST",
              headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
              body: form,
            });
            const j = r.ok ? await r.json().catch(() => ({})) : {};
            attempt = classifyAsrAttempt({
              hasKey: true,
              httpStatus: r.status,
              text: j.text || "",
            });
          } catch {
            attempt = classifyAsrAttempt({ hasKey: true, threw: true });
          }
        }
        if (attempt.kind === "ok") {
          text = attempt.text;
          model = whisperModel;
        } else if (attempt.kind !== "dry-run") {
          mediaFail = attempt;
        }
      } else if (job.bin === "vision") {
        const said = latestEvidenceText(tip, "transcript");
        let attempt = classifyVisionAttempt({ hasKey: false });
        if (process.env.GROQ_API_KEY) {
          try {
            const jpeg = readFileSync(fp);
            const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: visionModel,
                temperature: 0.2,
                max_tokens: 240,
                reasoning_effort: "none",
                response_format: { type: "json_object" },
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: visionPrompt({ transcript: said }) },
                      {
                        type: "image_url",
                        image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` },
                      },
                    ],
                  },
                ],
              }),
            });
            const j = r.ok ? await r.json().catch(() => ({})) : {};
            attempt = classifyVisionAttempt({
              hasKey: true,
              httpStatus: r.status,
              text: chatContent(j),
            });
          } catch {
            attempt = classifyVisionAttempt({ hasKey: true, threw: true });
          }
        }
        if (attempt.kind === "ok") {
          const parsed = parseVisionReply(attempt.text);
          if (!parsed.caption) {
            mediaFail = { kind: "error", reason: "empty_caption" };
          } else {
            text = parsed.caption;
            visionQuestion = parsed.question;
            model = visionModel;
          }
        } else if (attempt.kind !== "dry-run") {
          mediaFail = attempt;
        }
      }
      if (mediaFail) {
        const retry = mediaFail.kind === "retry";
        const vision = job.bin === "vision";
        tip.intake = "queued";
        tip.coachLine = retry
          ? vision
            ? "Photo analysis busy — will retry."
            : "Transcription busy — will retry."
          : vision
            ? "Photo analysis failed — still kept for retry."
            : "Transcription failed — audio kept for retry.";
        absorbNewerTip(tip, loadTip(job.region, job.ticket_uuid));
        scrubTipPii(tip);
        setJobState(job.region, tip, job.id, retry ? "queued" : "error");
        results.push({ id: job.id, error: mediaFail.reason, retry });
        continue;
      }
      text = convertPii(text).text;
      const real = model !== "dry-run" && !text.startsWith("[dry-run]");
      tip.evidence.push({
        id: randomUUID(),
        kind: job.bin === "asr" ? "transcript" : "text",
        role: job.bin === "vision" ? "vision" : undefined,
        uri: "",
        text,
        model,
        atMs: Date.now(),
        audioEvidenceId: ev.id,
      });
      if (real && !tip.fields.description.locked) {
        const description = composeTicketDescription({
          transcript: latestEvidenceText(tip, "transcript"),
          vision: evidenceTexts(tip, "vision"),
        });
        if (description) {
          tip.fields.description = {
            value: convertPii(description).text,
            source: "intake",
            locked: false,
          };
        }
      }
      if (job.bin === "asr") {
        if (real && !tip.fields.title.locked && text.length > 8) {
          tip.fields.title = {
            value: convertPii(text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 120)).text,
            source: "intake",
            locked: false,
          };
        }
        const stillsWaiting = (tip.jobs || []).some(
          (j) => j.bin === "vision" && (j.state === "queued" || j.state === "leased"),
        );
        tip.intake = real && !stillsWaiting ? "named_and_questions" : "queued";
        tip.coachLine = real
          ? stillsWaiting
            ? "Transcribed — describing the stills…"
            : "Got a transcript — review or add a still."
          : "ASR dry-run (set GROQ_API_KEY for Whisper) — waiting for real Batch…";
      } else if (job.bin === "vision") {
        const said = latestEvidenceText(tip, "transcript");
        if (real && !said && !tip.fields.title.locked && text.length > 8) {
          tip.fields.title = {
            value: convertPii(text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 120)).text,
            source: "intake",
            locked: false,
          };
        }
        if (real && visionQuestion) {
          tip.questions = mergeQuestions(tip.questions, convertPii(visionQuestion).text);
        }
        tip.intake = real ? "named_and_questions" : "queued";
        tip.coachLine = real
          ? visionQuestion
            ? "Need another look — see the question."
            : said
              ? "Matched the still to what you said — review the description."
              : "Described the still — add audio if this is not the problem."
          : "Photo analysis dry-run — description unchanged.";
      }
      if (real) {
        applySafetyRestraint(tip);
        applyConfidence(tip);
      }
      purgeUri(ev.uri);
      ev.uri = "";
      ev.processed = true;
      ev.purgedAtMs = Date.now();
      absorbNewerTip(tip, loadTip(job.region, job.ticket_uuid));
      scrubTipPii(tip);
      setJobState(job.region, tip, job.id, "done");
      results.push({ id: job.id, ok: true, model, textPreview: text.slice(0, 120) });
    }
    const processed = results.filter((r) => r.ok).length;
    if (processed > 0) scheduleDrain(0);
    else if (results.some((r) => r.deferred)) scheduleDrain(5000);
    return json(res, 200, { processed, results });
  }

  return json(res, 404, { error: "not_found" });
}

server.listen(PORT, () => {
  console.log(`myproblem-intake git SoT on :${PORT} regions=${REGIONS.join(",")}`);
});
