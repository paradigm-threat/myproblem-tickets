import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KEEP_SHOWING,
  OPENING_ASK,
  applyBatchReview,
  applyConfidence,
  chooseAsk,
  noteRollingClip,
  toPublicPost,
} from "./confidenceGauge.mjs";
import { applySafetyRestraint } from "./safetyRestraint.mjs";

function tip(title, description) {
  return {
    intake: "figuring_out",
    coachLine: "Figuring out…",
    fields: {
      title: { value: title, locked: false },
      description: { value: description, locked: false },
    },
    questions: [],
    evidence: [],
    safety: null,
  };
}

describe("confidence gauge", () => {
  it("asks what is happening when the problem is vague", () => {
    const gauge = applyConfidence(tip("Help", "It is broken."));
    assert.equal(gauge.ask, OPENING_ASK);
    assert.equal(gauge.phase, "understand");
    assert.equal(gauge.solution, null);
    assert.ok(gauge.understanding < 80);
    assert.equal(gauge.next, "What is happening, in one sentence?");
    assert.equal(gauge.instruction, "");
    assert.equal(gauge.public, false);
  });

  it("drills one missing fact at a time", () => {
    const first = applyConfidence(tip("Sink", "The kitchen sink is clogged."));
    assert.equal(first.next, "When did it start?");
    const second = applyConfidence(
      tip("Sink", "The kitchen sink is clogged since yesterday."),
    );
    assert.equal(second.next, "What have you already tried?");
    assert.equal(second.phase, "understand");
  });

  it("advises a short next step once an ordinary problem is specific", () => {
    const gauge = applyConfidence(
      tip(
        "Flat tire",
        "I have a flat tire on the roadside. It started this morning. I checked the spare in the trunk. I need to get to work.",
      ),
    );
    assert.ok(gauge.understanding >= 80);
    assert.ok(gauge.solution >= 65);
    assert.equal(gauge.phase, "advise");
    assert.match(gauge.instruction, /roadside service/);
    assert.equal(/splice/i.test(gauge.instruction), false);
  });

  it("holds a confusing guess below the solution threshold", () => {
    const gauge = applyConfidence(
      tip(
        "Sink",
        "The kitchen sink is clogged since yesterday. I tried a plunger. I need it to drain. Maybe the trap or the vent, not sure.",
      ),
    );
    assert.equal(gauge.phase, "batch");
    assert.ok(gauge.solution < 65);
    assert.equal(gauge.instruction, "");
    assert.match(gauge.line, /batch pass/);
  });

  it("shows the safety question instead of a closer look", () => {
    const row = tip(
      "Garage wiring",
      "I need to repair the electric wiring in my garage. It started this morning.",
    );
    row.safety = { hazard: "electrical", warned: true };
    row.questions = ["Look closer at the wires.", "Please provide a photo of the breaker."];
    row.coachLine = "Safety warning — electrical. MyProblem does not verify this is safe.";
    const gauge = applyConfidence(row);
    assert.match(gauge.ask, /hurt|sparks|licensed electrician/i);
    assert.equal(/look closer/i.test(gauge.ask), false);
    assert.equal(row.questions.some((q) => /look closer/i.test(q)), false);
  });

  it("uses a missing-shot question only when no requirements question remains", () => {
    const row = tip(
      "Flat tire",
      "I have a flat tire on the roadside. It started this morning. I checked the spare in the trunk. I need to get to work.",
    );
    const gauge = applyConfidence(row);
    assert.equal(gauge.phase, "advise");
    assert.equal(gauge.ask, KEEP_SHOWING);
    const held = { questions: ["Please provide a photo of the flat tire."], safety: null };
    assert.equal(chooseAsk(held, { hazard: null, next: "", understanding: 40 }), held.questions[0]);
  });

  it("keeps the session open for a rolling clip", () => {
    const row = tip("Sink", "The kitchen sink is clogged.");
    const gauge = applyConfidence(row);
    noteRollingClip(row);
    assert.equal(row.confidence.ask, gauge.ask);
    assert.match(row.confidence.ask, /When did it start/);
    assert.equal(row.coachLine.startsWith("Understanding"), true);
  });

  it("does not give wiring steps and stays under the solution threshold", () => {
    const row = tip(
      "Garage wiring",
      "I need to repair the electric wiring in my garage. It started this morning. Strip the wire and splice the hot to the neutral.",
    );
    row.coachLine = "Safety warning — electrical. MyProblem does not verify this is safe.";
    row.safety = { hazard: "electrical", warned: true };
    const gauge = applyConfidence(row);
    assert.equal(gauge.hazard, "electrical");
    assert.equal(gauge.phase, "batch");
    assert.ok(gauge.solution <= 28);
    assert.equal(gauge.instruction, "");
    assert.match(row.coachLine, /Safety warning/);
    assert.equal(/splice/i.test(gauge.line), false);
  });

  const stops = [
    ["I smell gas in the kitchen since this morning. I need it to stop.", "gas"],
    ["The kitchen is in flames. It started just now. I need everyone out.", "fire"],
    ["I have chest pain since this morning in the bedroom. I need help.", "medical"],
    ["I mixed bleach and ammonia in the bathroom. I need the fumes gone.", "chemical"],
    ["The ceiling is collapsing in the hallway. It started today. I need everyone out.", "structural"],
    ["A child is locked in a hot car. I need help now.", "hot_car"],
  ];

  for (const [text, hazard] of stops) {
    it(`stops advising on ${hazard}`, () => {
      const gauge = applyConfidence(tip(hazard, text));
      assert.equal(gauge.hazard, hazard);
      assert.equal(gauge.phase, "batch");
      assert.equal(gauge.instruction, "");
      assert.ok(gauge.solution <= 28);
    });
  }

  it("lets a batch knowledge hit lift an ordinary pattern and not a hazard", () => {
    const sink = tip(
      "Sink",
      "The kitchen sink is clogged since yesterday. I tried a plunger. I need it to drain. Maybe the trap or the vent, not sure.",
    );
    const lifted = applyBatchReview(sink, { kbHit: true });
    assert.equal(lifted.phase, "advise");
    assert.ok(lifted.solution >= 65);
    assert.equal(lifted.public, false);
    assert.equal(lifted.backup.used, false);
    assert.deepEqual(lifted.backup.providers, ["grok"]);

    const wiring = tip(
      "Garage wiring",
      "I need to repair the electric wiring in my garage. It started this morning.",
    );
    wiring.coachLine = "Safety warning — electrical. MyProblem does not verify this is safe.";
    wiring.safety = { hazard: "electrical", warned: true };
    const handed = applyBatchReview(wiring, { kbHit: true });
    assert.equal(handed.phase, "human");
    assert.equal(handed.immediate, false);
    assert.equal(handed.public, true);
    assert.ok(handed.solution <= 28);
    assert.equal(handed.instruction, "");
    assert.match(handed.line, /person should continue/);
  });

  it("does not read the attached warning as a live emergency", () => {
    const quiet = tip(
      "Garage wiring",
      "I need to repair the electric wiring in my garage. It started this morning. Strip the wire and splice the hot to the neutral.",
    );
    applySafetyRestraint(quiet);
    const handed = applyBatchReview(quiet, { kbHit: false });
    assert.equal(handed.hazard, "electrical");
    assert.equal(handed.immediate, false);
    assert.equal(handed.public, true);

    const live = tip(
      "Garage wiring",
      "The garage wiring is sparking and I see sparks. It started just now.",
    );
    applySafetyRestraint(live);
    const held = applyBatchReview(live, { kbHit: false });
    assert.equal(held.immediate, true);
    assert.equal(held.public, false);
    assert.match(held.line, /stays private/);
  });

  it("keeps an emergency private after the batch pass", () => {
    const emergencies = [
      ["I smell gas in the kitchen since this morning. I need it to stop.", "gas"],
      ["The kitchen is in flames. It started just now. I need everyone out.", "fire"],
      ["I have chest pain since this morning in the bedroom. I need help.", "medical"],
      ["I mixed bleach and ammonia in the bathroom. I need the fumes gone.", "chemical"],
      ["The ceiling is collapsing in the hallway. It started today. I need everyone out.", "structural"],
      ["A child is locked in a hot car. I need help now.", "hot_car"],
      ["Water is pouring into the breaker panel. It started just now.", "water_electric"],
      ["I am up a ladder on the roof. I need to get down.", "heights"],
      ["I don't want to live anymore.", "crisis"],
      ["The outlet is sparking and I got shocked. It started just now.", "electrical"],
    ];
    for (const [text, hazard] of emergencies) {
      const row = tip(hazard, text);
      const gauge = applyBatchReview(row, { kbHit: true });
      assert.equal(gauge.hazard, hazard, text);
      assert.equal(gauge.immediate, true, text);
      assert.equal(gauge.phase, "human", text);
      assert.equal(gauge.public, false, text);
      assert.equal(gauge.instruction, "", text);
      assert.match(gauge.line, /stays private/);
      assert.equal(/public/i.test(gauge.line), false);
    }
  });

  it("publishes a redacted post without the claim or a repair step", () => {
    const row = tip(
      "Garage wiring",
      "I need to repair the electric wiring in my garage. It started this morning. Call me at 404-555-0199. I live at 18 Oak Street. Strip the wire and splice the hot.",
    );
    row.ticket_uuid = "11111111-1111-1111-1111-111111111111";
    row.region = "georgia";
    row.claim = "secret-claim-should-not-leak";
    row.coachLine = "Safety warning — electrical. MyProblem does not verify this is safe.";
    row.safety = { hazard: "electrical", warned: true };
    applyBatchReview(row, { kbHit: false });
    const post = toPublicPost(row);
    const blob = JSON.stringify(post);
    assert.equal(post.ticket_uuid, row.ticket_uuid);
    assert.equal(post.confidence.phase, "human");
    assert.equal(blob.includes("secret-claim"), false);
    assert.equal(blob.includes("404-555-0199"), false);
    assert.equal(blob.includes("18 Oak Street"), false);
    assert.equal(/splice/i.test(blob), false);
    assert.match(blob, /phone withheld|address in/);
    assert.match(post.note, /person should continue/);
  });

  it("keeps a chirping alarm with no smoke on the ordinary path", () => {
    const gauge = applyConfidence(
      tip(
        "Chirp",
        "The alarm is chirping but there is no fire. It is in the hallway. It started last night. I tried a new battery. I need the chirp to stop.",
      ),
    );
    assert.equal(gauge.hazard, null);
    assert.equal(gauge.phase, "advise");
    assert.match(gauge.instruction, /battery/);
  });
});
