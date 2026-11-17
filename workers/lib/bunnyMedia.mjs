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
const REGIONS_ROOT = process.env.TICKETS_REGIONS_ROOT || join(ROOT, "regions");

/** Repos that may declare a media-upload.json (tip homes + fixit stub). */
export const MEDIA_REPO_KEYS = ["georgia", "israel", "fixit"];

const KEY = () => process.env.BUNNY_STORAGE_API_KEY?.trim() || "";

/**
 * Load per-repo upload destination. Secrets never come from the file.
 * @param {string} repoKey georgia|israel|fixit (usually tip.region)
 */
export function loadMediaUploadConfig(repoKey) {
  const key = String(repoKey || "").trim();
  if (!MEDIA_REPO_KEYS.includes(key)) {
    return { ok: false, error: `unknown_media_repo:${key}` };
  }
  const path = join(REGIONS_ROOT, key, "media-upload.json");
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

/**
 * Upload scrubbed JPEG bytes using the tip repo’s destination.
 * @returns {{ ok: true, path: string, uri: string } | { ok: false, error: string, detail?: string }}
 */
export async function bunnyUploadStill(repoKey, ticketUuid, evidenceId, jpegBytes) {
  const cfg = loadMediaUploadConfig(repoKey);
  if (!cfg.ok) return { ok: false, error: cfg.error };
  if (!KEY()) return { ok: false, error: "bunny_not_configured" };

  const path = objectPath(cfg, ticketUuid, evidenceId);
  const url = `https://${cfg.storage_host}/${cfg.storage_zone}/${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: KEY(),
      "Content-Type": "image/jpeg",
    },
    body: jpegBytes,
  });
  if (!res.ok) {
    return { ok: false, error: `bunny_upload_${res.status}`, detail: await res.text() };
  }
  return { ok: true, path, uri: `${cfg.cdn_host}/${path}` };
}

/** Delete one still (or best-effort). */
export async function bunnyDeleteStill(repoKey, ticketUuid, evidenceId) {
  const cfg = loadMediaUploadConfig(repoKey);
  if (!cfg.ok) return { ok: false, error: cfg.error };
  if (!KEY()) return { ok: false, error: "bunny_not_configured" };

  const path = objectPath(cfg, ticketUuid, evidenceId);
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
 * Expire all Bunny stills for a tip (solved / unpublish / close).
 * Call after scrubbed public media is no longer needed.
 */
export async function bunnyExpireTicketMedia(tip) {
  const repoKey = tip?.region || tip?.home || "";
  const results = [];
  for (const ev of tip.evidence || []) {
    if (ev.kind !== "still") continue;
    if (!ev.uri || !String(ev.uri).includes("b-cdn.net")) continue;
    results.push(await bunnyDeleteStill(repoKey, tip.ticket_uuid, ev.id));
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
