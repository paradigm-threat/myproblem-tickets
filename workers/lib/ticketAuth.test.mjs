import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import {
  issueClaim,
  requireClaimEnabled,
  authorizeTicket,
  extractPresentedClaim,
} from "./ticketAuth.mjs";

describe("ticketAuth", () => {
  const prev = process.env.REQUIRE_TICKET_CLAIM;

  after(() => {
    if (prev === undefined) delete process.env.REQUIRE_TICKET_CLAIM;
    else process.env.REQUIRE_TICKET_CLAIM = prev;
  });

  it("issues unique hex claims", () => {
    const a = issueClaim();
    const b = issueClaim();
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, b);
  });

  it("UUID-only when REQUIRE_TICKET_CLAIM off", () => {
    process.env.REQUIRE_TICKET_CLAIM = "0";
    assert.equal(requireClaimEnabled(), false);
    assert.equal(authorizeTicket({ headers: {} }, { claim: "secret" }, { hasApiSecret: false }), true);
  });

  it("requires matching claim when enabled", () => {
    process.env.REQUIRE_TICKET_CLAIM = "1";
    const tip = { claim: "abc123def456abc123def456abc123de" };
    assert.equal(authorizeTicket({ headers: {} }, tip, { hasApiSecret: false }), false);
    assert.equal(
      authorizeTicket(
        { headers: { authorization: `Bearer ${tip.claim}` } },
        tip,
        { hasApiSecret: false },
      ),
      true,
    );
    assert.equal(
      authorizeTicket(
        { headers: { "x-ticket-claim": tip.claim } },
        tip,
        { hasApiSecret: false },
      ),
      true,
    );
    assert.equal(
      authorizeTicket({ headers: { authorization: "Bearer wrong" } }, tip, { hasApiSecret: false }),
      false,
    );
  });

  it("API secret bypasses claim", () => {
    process.env.REQUIRE_TICKET_CLAIM = "1";
    assert.equal(
      authorizeTicket({ headers: {} }, { claim: "needme" }, { hasApiSecret: true }),
      true,
    );
  });

  it("legacy tips without claim still open under REQUIRE", () => {
    process.env.REQUIRE_TICKET_CLAIM = "1";
    assert.equal(authorizeTicket({ headers: {} }, { claim: null }, { hasApiSecret: false }), true);
  });

  it("extracts claim from headers", () => {
    assert.equal(extractPresentedClaim({ headers: { "x-ticket-claim": " z " } }), "z");
    assert.equal(
      extractPresentedClaim({ headers: { authorization: "Bearer tok" } }),
      "tok",
    );
  });
});
