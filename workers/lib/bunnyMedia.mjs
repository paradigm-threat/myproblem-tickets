/**
 * Bunny.net live ticket stills — scrubbed public media while a tip is live.
 * Destination (zone, CDN, path_prefix) lives in each tip repo’s media-upload.json.
 * Shared API key: BUNNY_STORAGE_API_KEY (Intake/Batch secrets only — never tip git).
 *
 * Optional env overrides when a repo file is missing fields:
 *   BUNNY_STORAGE_ZONE, BUNNY_CDN_HOST, BUNNY_STORAGE_HOST
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

/** Repos that may declare a media-upload.json (tip homes + fixit stub). */
export const MEDIA_REPO_KEYS = ["georgia", "israel", "fixit"];

const KEY = () => process.env.BUNNY_STORAGE_API_KEY?.trim() || "";
const regionsRoot = () => process.env.TICKETS_REGIONS_ROOT || join(ROOT, "regions");

/**
 * Load per-repo upload destination. Secrets never come from the file.
 * @param {string} repoKey georgia|israel|fixit (usually tip.region)
 */
export function loadMediaUploadConfig(repoKey) {
  const key = String(repoKey || "").trim();
  if (!MEDIA_REPO_KEYS.includes(key)) {
    return { ok: false, error: `unknown_media_repo:${key}` };
  }
  const path = join(regionsRoot(), key, "media-upload.json");
  let file = {};
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, "utf8")) || {};
    } catch {
      return { ok: false, error: "media_upload_json_invalid" };
    }
  }
  const storage_zone =
    String(file.storage_zone || process.env.BUNNY_STORAGE_ZONE || "").trim();
  const cdn_host = String(
    file.cdn_host || process.env.BUNNY_CDN_HOST || "",
  )
    .trim()
    .replace(/\/$/, "");
  const storage_host = String(
    file.storage_host || process.env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com",
  )
    .trim()
    .replace(/\/$/, "");
  const path_prefix = String(file.path_prefix || key)
    .trim()
    .replace(/^\/+|\/+$/g, "");

  const resolvedCdn =
    cdn_host || (storage_zone ? `https://${storage_zone}.b-cdn.net` : "");

  if (!storage_zone || !resolvedCdn || !path_prefix) {
    return { ok: false, error: "media_upload_incomplete", path };
  }
  return {
    ok: true,
    provider: file.provider || "bunny",
    storage_zone,
    cdn_host: resolvedCdn,
    storage_host,
    path_prefix,
    api_key_configured: Boolean(KEY()),
  };
}

export function bunnyConfigured(repoKey) {
  const cfg = loadMediaUploadConfig(repoKey);
  return Boolean(cfg.ok && KEY() && cfg.storage_zone && cfg.cdn_host);
}

function objectPath(cfg, ticketUuid, evidenceId) {
  return `${cfg.path_prefix}/tickets/${ticketUuid}/${evidenceId}.jpg`;
}

/** Private batch inbox — not a public CDN object. */
function inboxObjectPath(cfg, ticketUuid, evidenceId, ext) {
  const safe = String(ext || "bin").replace(/^\./, "").replace(/[^a-zA-Z0-9]+/g, "") || "bin";
  return `${cfg.path_prefix}/inbox/tickets/${ticketUuid}/${evidenceId}.${safe}`;
}

async function bunnyPut(cfg, path, bytes, contentType) {
  const url = `https://${cfg.storage_host}/${cfg.storage_zone}/${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: KEY(),
      "Content-Type": contentType || "application/octet-stream",
    },
    body: bytes,
  });
  if (!res.ok) {
    return { ok: false, error: `bunny_upload_${res.status}`, detail: await res.text() };
  }
  return {
    ok: true,
    path,
    // Storage host URI — Batch reads with AccessKey. Not a public b-cdn link.
    uri: `https://${cfg.storage_host}/${cfg.storage_zone}/${path}`,
  };
}

async function bunnyDeletePath(cfg, path) {
  const url = `https://${cfg.storage_host}/${cfg.storage_zone}/${path}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { AccessKey: KEY() },
  });
  if (!res.ok && res.status !== 404) {
    return { ok: false, error: `bunny_delete_${res.status}` };
  }
  return { ok: true, path };
}

/**
 * Upload scrubbed JPEG bytes using the tip repo’s destination.
 * @returns {{ ok: true, path: string, uri: string } | { ok: false, error: string, detail?: string }}
 */
export async function bunnyUploadStill(repoKey, ticketUuid, evidenceId, jpegBytes) {
  const cfg = loadMediaUploadConfig(repoKey);
  if (!cfg.ok) return { ok: false, error: cfg.error };
  if (!KEY()) return { ok: false, error: "bunny_not_configured" };

  const path = objectPath(cfg, ticketUuid, evidenceId);
  const up = await bunnyPut(cfg, path, jpegBytes, "image/jpeg");
  if (!up.ok) return up;
  return { ok: true, path: up.path, uri: `${cfg.cdn_host}/${up.path}` };
}

/**
 * Upload raw video/audio/other into the private batch inbox (not public CDN).
 * Tip should store inbox_uri + bunnyPath; public pages never link this URI.
 */
export async function bunnyUploadInbox(
  repoKey,
  ticketUuid,
  evidenceId,
  bytes,
  ext = "bin",
  contentType = "application/octet-stream",
) {
  const cfg = loadMediaUploadConfig(repoKey);
  if (!cfg.ok) return { ok: false, error: cfg.error };
  if (!KEY()) return { ok: false, error: "bunny_not_configured" };
  const path = inboxObjectPath(cfg, ticketUuid, evidenceId, ext);
  return bunnyPut(cfg, path, bytes, contentType);
}

/** Delete one still (or best-effort). */
export async function bunnyDeleteStill(repoKey, ticketUuid, evidenceId) {
  const cfg = loadMediaUploadConfig(repoKey);
  if (!cfg.ok) return { ok: false, error: cfg.error };
  if (!KEY()) return { ok: false, error: "bunny_not_configured" };
  return bunnyDeletePath(cfg, objectPath(cfg, ticketUuid, evidenceId));
}

/**
 * Expire Bunny stills + private inbox objects for a tip (solved / unpublish / close).
 */
export async function bunnyExpireTicketMedia(tip) {
  const repoKey = tip?.region || tip?.home || "";
  const cfg = loadMediaUploadConfig(repoKey);
  const results = [];
  for (const ev of tip.evidence || []) {
    if (ev.kind === "still" && ev.uri && String(ev.uri).includes("b-cdn.net")) {
      results.push(await bunnyDeleteStill(repoKey, tip.ticket_uuid, ev.id));
    }
    if (ev.bunnyPath && cfg.ok && KEY()) {
      results.push(await bunnyDeletePath(cfg, ev.bunnyPath));
    }
  }
  return results;
}

/**
 * Batch finalize: link nominated choice stills to Bunny; delete unused cache stills.
 *
 * Only the server Batch path calls this. APK may nominate `choice: true` on upload;
 * Batch passes the final `choice_ids`. Requires scrub confirmation (fail closed).
 *
 * @param {object} tip
 * @param {{ choice_ids: string[], confirm_scrubbed?: boolean, resolveCache: (uri: string) => string|null, purgeUri: (uri: string) => void, readFile: (fp: string) => Buffer }} deps
 */
export async function finalizeChoiceStills(tip, deps) {
  const choiceSet = new Set((deps.choice_ids || []).map(String));
  const confirm = deps.confirm_scrubbed === true;
  const linked = [];
  const deleted = [];
  const errors = [];

  for (const ev of tip.evidence || []) {
    if (ev.kind !== "still") continue;
    const isChoice = choiceSet.has(ev.id);
    const cachePath =
      ev.uri && String(ev.uri).startsWith("cache://")
        ? deps.resolveCache(ev.uri)
        : null;

    if (isChoice) {
      if (!confirm) {
        errors.push({ id: ev.id, error: "scrub_not_confirmed" });
        continue;
      }
      if (!cachePath) {
        // Already on CDN
        if (ev.uri && String(ev.uri).includes("b-cdn.net")) {
          ev.choice = true;
          ev.scrubbed = true;
          linked.push({ id: ev.id, uri: ev.uri, already: true });
          continue;
        }
        errors.push({ id: ev.id, error: "cache_missing" });
        continue;
      }
      const bytes = deps.readFile(cachePath);
      const up = await bunnyUploadStill(tip.region, tip.ticket_uuid, ev.id, bytes);
      if (!up.ok) {
        errors.push({ id: ev.id, error: up.error, detail: up.detail });
        continue;
      }
      deps.purgeUri(ev.uri);
      ev.uri = up.uri;
      ev.choice = true;
      ev.scrubbed = true;
      ev.bunnyPath = up.path;
      linked.push({ id: ev.id, uri: up.uri });
      continue;
    }

    // Not chosen — drop cache (and any accidental CDN link)
    if (ev.uri && String(ev.uri).startsWith("cache://")) {
      deps.purgeUri(ev.uri);
      ev.uri = "";
      ev.purgedAtMs = Date.now();
      deleted.push(ev.id);
    } else if (ev.uri && String(ev.uri).includes("b-cdn.net")) {
      await bunnyDeleteStill(tip.region, tip.ticket_uuid, ev.id);
      ev.uri = "";
      ev.choice = false;
      ev.scrubbed = false;
      ev.purgedAtMs = Date.now();
      deleted.push(ev.id);
    }
  }

  tip.updatedAtMs = Date.now();
  return { linked, deleted, errors };
}
