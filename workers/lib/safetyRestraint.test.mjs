import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySafetyRestraint, classifyHazard, stripProcedural } from "./safetyRestraint.mjs";

describe("safety restraints", () => {
  const cases = [
    ["I need to repair the electric wiring in my garage.", "electrical"],
    ["The outlet is sparking and I got shocked.", "electrical"],
    ["Water is pouring into the breaker panel.", "water_electric"],
    ["I smell gas in the kitchen.", "gas"],
    ["The CO alarm is going off.", "gas"],
    ["The kitchen is in flames.", "fire"],
    ["I have chest pain and I can't breathe.", "medical"],
    ["I mixed bleach and ammonia in the bathroom.", "chemical"],
    ["The ceiling is collapsing in the hallway.", "structural"],
    ["I am up a ladder on the roof.", "heights"],
    ["A child is locked in a hot car.", "hot_car"],
    ["I don't want to live anymore.", "crisis"],
  ];

  for (const [text, hazard] of cases) {
    it(`warns on: ${hazard}`, () => {
      assert.equal(classifyHazard(text), hazard);
      const tip = {
        intake: "advice_ready",
        fields: {
          title: { value: text, locked: false },
          description: { value: "Then splice the hot to the neutral and turn the breaker back on.", locked: false },
        },
        questions: ["Which wires should I splice?"],
        evidence: [],
      };
      assert.equal(applySafetyRestraint(tip), hazard);
      assert.match(tip.coachLine, /Safety warning/);
      assert.match(tip.coachLine, /does not verify/);
      assert.match(tip.fields.description.value, /does not verify/);
      assert.equal(tip.fields.description.value.includes("splice"), false);
      assert.equal(tip.questions.some((q) => /splice/i.test(q)), false);
      assert.equal(tip.safety.warned, true);
      assert.equal(tip.intake, "named_and_questions");
    });
  }

  it("leaves ordinary problems alone", () => {
    for (const text of [
      "I have a flat tire on the roadside.",
      "I cut my finger while chopping vegetables. It is still bleeding after ten minutes.",
      "The alarm is chirping but I do not smell smoke. There is no fire.",
      "The sink is clogged.",
    ]) {
      assert.equal(classifyHazard(text), null, text);
    }
  });

  it("drops wiring steps from a caption", () => {
    const cleaned = stripProcedural(
      "The outlet cover is off. Strip the wire and splice the hot. The box looks old.",
    );
    assert.match(cleaned, /outlet cover/);
    assert.equal(/splice/i.test(cleaned), false);
  });
});
