/**
 * Bunny.net live ticket stills — scrubbed public media while a tip is live.
 * Expire / delete when ticket solved, public post removed, or Evidence removed.
 *
 * Env (Intake/Batch only — never Vercel marketing):
 *   BUNNY_STORAGE_ZONE, BUNNY_STORAGE_API_KEY, BUNNY_CDN_HOST
 *   BUNNY_STORAGE_HOST (default storage.bunnycdn.com)
 */

const ZONE = () => process.env.BUNNY_STORAGE_ZONE?.trim() || "";
const KEY = () => process.env.BUNNY_STORAGE_API_KEY?.trim() || "";
const CDN = () =>
  (process.env.BUNNY_CDN_HOST || "").replace(/\/$/, "") ||
  (ZONE() ? `https://${ZONE()}.b-cdn.net` : "");
const STORAGE_HOST = () =>
  (process.env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com").replace(/\/$/, "");

export function bunnyConfigured() {
  return Boolean(ZONE() && KEY() && CDN());
}

function objectPath(ticketUuid, evidenceId) {
  return `tickets/${ticketUuid}/${evidenceId}.jpg`;
}

/** Upload scrubbed JPEG bytes; returns public CDN URL + storage path. */
export async function bunnyUploadStill(ticketUuid, evidenceId, jpegBytes) {
  if (!bunnyConfigured()) {
    return { ok: false, error: "bunny_not_configured" };
  }
  const path = objectPath(ticketUuid, evidenceId);
  const url = `https://${STORAGE_HOST()}/${ZONE()}/${path}`;
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
  return { ok: true, path, uri: `${CDN()}/${path}` };
}

/** Delete one still (or best-effort). */
export async function bunnyDeleteStill(ticketUuid, evidenceId) {
  if (!bunnyConfigured()) return { ok: false, error: "bunny_not_configured" };
  const path = objectPath(ticketUuid, evidenceId);
  const url = `https://${STORAGE_HOST()}/${ZONE()}/${path}`;
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
  const results = [];
  for (const ev of tip.evidence || []) {
    if (ev.kind !== "still") continue;
    if (!ev.uri || !String(ev.uri).includes("b-cdn.net")) continue;
    results.push(await bunnyDeleteStill(tip.ticket_uuid, ev.id));
  }
  return results;
}
