import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyAsrAttempt } from "./asrAttempt.mjs";

describe("classifyAsrAttempt", () => {
  it("dry-runs only when no key", () => {
    assert.deepEqual(classifyAsrAttempt({ hasKey: false }), { kind: "dry-run" });
  });

  it("accepts a real transcript", () => {
    assert.deepEqual(
      classifyAsrAttempt({ hasKey: true, httpStatus: 200, text: "  flat tire  " }),
      { kind: "ok", text: "flat tire" },
    );
  });

  it("retries rate limits and server errors without treating them as text", () => {
    assert.equal(classifyAsrAttempt({ hasKey: true, httpStatus: 429 }).kind, "retry");
    assert.equal(classifyAsrAttempt({ hasKey: true, httpStatus: 503 }).kind, "retry");
    assert.equal(classifyAsrAttempt({ hasKey: true, threw: true }).kind, "retry");
  });

  it("errors on auth failure or empty text and does not look like success", () => {
    assert.equal(classifyAsrAttempt({ hasKey: true, httpStatus: 401 }).kind, "error");
    assert.equal(classifyAsrAttempt({ hasKey: true, httpStatus: 200, text: "   " }).kind, "error");
  });
});
