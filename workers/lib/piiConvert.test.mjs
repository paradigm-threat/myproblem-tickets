import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convertPii } from "./piiConvert.mjs";

describe("convertPii", () => {
  it("strips street addresses", () => {
    const { text, changed } = convertPii("Meet at 456 Oak Avenue please");
    assert.equal(changed, true);
    assert.ok(!text.includes("456 Oak"));
  });

  it("drops the unit and the comma left beside a street", () => {
    const { text } = convertPii(
      "The leak is under the sink. The house is 18 Oak Street, apartment 4B.",
    );
    assert.ok(text.includes("an address in the local area."));
    assert.ok(!text.includes("18 Oak"));
    assert.ok(!text.includes("4B"));
    assert.ok(!text.includes(", ."));
  });

  it("withholds phone and email", () => {
    const { text } = convertPii("call 404-555-1212 or x@y.com");
    assert.ok(text.includes("[phone withheld]"));
    assert.ok(text.includes("[email withheld]"));
  });
});
