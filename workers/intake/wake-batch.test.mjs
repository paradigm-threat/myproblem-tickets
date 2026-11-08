import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldWakeBatch } from "./wake-batch.mjs";

describe("shouldWakeBatch", () => {
  it("wakes on asr depth", () => {
    const d = shouldWakeBatch({ asr: 2, vision: 0, project: 0 }, 0, {
      asrMin: 1,
      visionMin: 1,
      projectMin: 1,
      maxAgeHours: 24,
    });
    assert.equal(d.wake, true);
    assert.equal(d.reason, "depth");
  });

  it("wakes on age when any GPU bin pending", () => {
    const d = shouldWakeBatch({ asr: 0, vision: 1, project: 0 }, 30, {
      asrMin: 5,
      visionMin: 5,
      projectMin: 5,
      maxAgeHours: 24,
    });
    assert.equal(d.wake, true);
    assert.equal(d.reason, "age");
  });

  it("stays quiet when empty", () => {
    const d = shouldWakeBatch({ asr: 0, vision: 0, project: 0 }, 100, {
      asrMin: 1,
      visionMin: 1,
      projectMin: 1,
      maxAgeHours: 24,
    });
    assert.equal(d.wake, false);
  });
});
