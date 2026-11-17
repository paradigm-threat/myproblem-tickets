/**
 * Batch still scrub before public / Bunny publish.
 *
 * Policy (fixit / all public stills):
 * - Blur or crop out faces, bodies, readable street numbers, mailboxes,
 *   license plates, and other identity / fine-location cues.
 * - Strip EXIF / GPS.
 * - If scrub confidence is low → do not publish; request a closer box-only still.
 *
 * Implementation: run VL / detector on Spot or Bedrock; apply blur masks;
 * re-encode JPEG without EXIF. This module is the contract + helper stubs.
 */

export const STILL_SCRUB_INSTRUCTIONS = `
Before any still is published or Bunny-linked for helpers:
1. Detect faces, people, street numbers, mailboxes, license plates, GPS EXIF.
2. Blur or crop those regions; prefer wiring/box-only crops for electrical tickets.
3. Re-encode JPEG with EXIF stripped.
4. If identity/location cues remain uncertain, do not publish that frame —
   ask for a re-crop (closer junction / cable only).
5. Never put raw uploads on the public ticket page.
`.trim();

/**
 * @param {Buffer} _jpegBytes
 * @returns {{ ok: boolean, scrubbed?: Buffer, blocked?: boolean, reason?: string }}
 */
export function scrubStillForPublic(_jpegBytes) {
  // Placeholder until Spot VL scrub job is wired. Fail closed for automation.
  return {
    ok: false,
    blocked: true,
    reason: "still_scrub_not_implemented — use manual crop for pilot; Batch must not publish raw",
  };
}

export function publicStillAllowed(evidence) {
  if (!evidence || evidence.kind !== "still") return false;
  if (evidence.scrubbed === true && evidence.uri) return true;
  if (evidence.uri && String(evidence.uri).startsWith("/pilot/")) return true;
  return false;
}
