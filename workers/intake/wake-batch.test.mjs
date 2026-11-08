import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldWakeBatch } from "./wake-batch.mjs";

describe("shouldWakeBatch", () => {
  it("wakes on asr depth", () => {
    const d = shouldWakeBatch({ asr: 1, vision: 0, project: 0 }, 0, {
      asrMin: 1,
      visionMin: 1,
      projectMin: 1,
      maxAgeHours: 24,
    });
    assert.equal(d.wake, true);
    assert.equal(d.reason, "depth");
  });

  it("wakes on age when any GPU bin pending", () => {
    const d = shouldWakeBatch({ asr: 1, vision: 0, project: 0 }, 30, {
      asrMin: 99,
      visionMin: 99,
      projectMin: 99,
      maxAgeHours: 24,
    });
    assert.equal(d.wake, true);
    assert.equal(d.reason, "age");
  });

  it("stays quiet", () => {
    const d = shouldWakeBatch({ asr: 0, vision: 0, project: 0 }, 0, {
      asrMin: 1,
      visionMin: 1,
      projectMin: 1,
      maxAgeHours: 24,
    });
    assert.equal(d.wake, false);
  });
});
