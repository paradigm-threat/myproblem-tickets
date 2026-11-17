import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { suggestPublicSlug } from "./suggestSlug.mjs";

describe("suggestPublicSlug", () => {
  it("suggests a topic-shaped slug", () => {
    const r = suggestPublicSlug({
      title: "Garage lights kill outdoor Ring power",
      description: "Always-on outlet dies when switch turns lights off",
      existingSlugs: [],
    });
    assert.match(r.suggested, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(r.suggested.length >= 4);
    assert.ok(r.suggested.includes("garage") || r.suggested.includes("ring"));
  });

  it("avoids existing slug collisions", () => {
    const first = suggestPublicSlug({
      title: "Garage Ring power",
      existingSlugs: [],
    });
    const second = suggestPublicSlug({
      title: "Garage Ring power",
      existingSlugs: [first.suggested],
    });
    assert.notEqual(second.suggested, first.suggested);
  });
});
