/**
 * Ticket access: UUID is the capability; claim is defense-in-depth when
 * REQUIRE_TICKET_CLAIM=1. API secret always bypasses for trusted proxies/ops.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

export function issueClaim() {
  return randomBytes(32).toString("hex");
}

export function requireClaimEnabled() {
  const v = (process.env.REQUIRE_TICKET_CLAIM || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Presented claim from x-ticket-claim or Authorization: Bearer (non-API-secret). */
export function extractPresentedClaim(req) {
  const hdr = req.headers?.["x-ticket-claim"];
  if (hdr && String(hdr).trim()) return String(hdr).trim();
  const auth = req.headers?.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    return token || null;
  }
  return null;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{ claim?: string|null }|null} tip
 * @param {{ hasApiSecret: boolean }} opts
 */
export function authorizeTicket(req, tip, { hasApiSecret }) {
  if (!tip) return false;
  if (hasApiSecret) return true;
  if (!requireClaimEnabled()) return true; // UUID capability only
  if (!tip.claim) return true; // legacy tips created before claims
  const presented = extractPresentedClaim(req);
  if (!presented) return false;
  return safeEqual(presented, tip.claim);
}
