import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatContent,
  classifyVisionAttempt,
  composeTicketDescription,
  latestEvidenceText,
  absorbNewerTip,
  mergeQuestions,
  parseVisionReply,
  shouldDeferVision,
  visionPrompt,
} from "./visionAttempt.mjs";

describe("classifyVisionAttempt", () => {
  it("dry-runs when no vision model key", () => {
    assert.deepEqual(classifyVisionAttempt({ hasKey: false }), { kind: "dry-run" });
  });

  it("keeps a short caption and drops think tags", () => {
    const result = classifyVisionAttempt({
      hasKey: true,
      httpStatus: 200,
      text: "<think>hidden</think> The front tire is flat.",
    });
    assert.equal(result.kind, "ok");
    assert.equal(result.text, "The front tire is flat.");
  });

  it("retries when busy and errors on an empty caption", () => {
    assert.equal(classifyVisionAttempt({ hasKey: true, httpStatus: 429 }).kind, "retry");
    assert.equal(classifyVisionAttempt({ hasKey: true, httpStatus: 200, text: "  " }).kind, "error");
  });
});

describe("ticket description from speech and a still", () => {
  it("puts the transcript first and the still after it", () => {
    const desc = composeTicketDescription({
      transcript: "The spare is in the trunk.",
      vision: "A black tire is flat on the pavement.",
    });
    assert.match(desc, /^The spare is in the trunk\./);
    assert.match(desc, /From the still: A black tire is flat/);
  });

  it("keeps every unique frame, not only the last", () => {
    const desc = composeTicketDescription({
      transcript: "The sink is leaking.",
      vision: ["Water under the cabinet.", "The trap is wet."],
    });
    assert.match(desc, /Frame 1: Water under the cabinet/);
    assert.match(desc, /Frame 2: The trap is wet/);
  });

  it("waits for speech that is still queued, then stops waiting", () => {
    const now = 1_000_000;
    const waiting = {
      jobs: [{ bin: "asr", state: "queued" }],
      evidence: [{ kind: "still", processed: false, atMs: now - 120_000, uri: "cache://x" }],
    };
    assert.equal(shouldDeferVision(waiting, now, 45_000), true);
    const quiet = {
      jobs: [{ bin: "vision", state: "queued", updatedAtMs: now - 60_000 }],
      evidence: [{ kind: "still", processed: false, atMs: now - 60_000 }],
    };
    assert.equal(shouldDeferVision(quiet, now, 45_000), false);
    const heard = {
      jobs: [],
      evidence: [{ kind: "transcript", model: "whisper", text: "The tire is flat." }],
    };
    assert.equal(shouldDeferVision(heard, now, 45_000), false);
  });

  it("uses whichever side exists", () => {
    assert.equal(composeTicketDescription({ vision: "A cracked screen." }), "A cracked screen.");
    assert.equal(composeTicketDescription({ transcript: "It will not drain." }), "It will not drain.");
  });

  it("keeps a still that landed while speech was being transcribed", () => {
    const working = {
      evidence: [{ id: "a", kind: "audio" }],
      jobs: [{ id: "asr1", bin: "asr", state: "leased" }],
      timeline: [{ id: "t1" }],
      questions: [],
    };
    const saved = {
      evidence: [
        { id: "a", kind: "audio" },
        { id: "s", kind: "still" },
      ],
      jobs: [
        { id: "asr1", bin: "asr", state: "queued" },
        { id: "v1", bin: "vision", state: "queued" },
      ],
      timeline: [{ id: "t1" }, { id: "t2" }],
      questions: [],
    };
    absorbNewerTip(working, saved);
    assert.equal(working.evidence.length, 2);
    assert.equal(working.jobs.find((j) => j.id === "asr1").state, "leased");
    assert.ok(working.jobs.some((j) => j.bin === "vision"));
  });

  it("asks for the missing shot only when the frame does not show the problem", () => {
    const missed = parseVisionReply(
      '{"caption":"The frame is a text card, not a tire.","question":"Can you show the flat tire?"}',
    );
    assert.equal(missed.caption, "The frame is a text card, not a tire.");
    assert.equal(missed.question, "Can you show the flat tire?");
    const shown = parseVisionReply('{"caption":"The front tire is flat.","question":""}');
    assert.equal(shown.question, "");
    assert.deepEqual(mergeQuestions(["Can you show the flat tire?"], "Can you show the flat tire?"), [
      "Can you show the flat tire?",
    ]);
  });

  it("prompts with the words they said", () => {
    const prompt = visionPrompt({ transcript: "The rear passenger tire is flat." });
    assert.match(prompt, /rear passenger tire/);
    assert.match(prompt, /unique frame/);
  });

  it("ignores dry-run captions when composing later", () => {
    const tip = {
      evidence: [
        { kind: "transcript", model: "whisper-large-v3", text: "Flat tire." },
        { kind: "text", role: "vision", model: "dry-run", text: "[dry-run] still.jpg" },
        { kind: "text", role: "vision", model: "qwen/qwen3.8-27b", text: "The tire is flat." },
      ],
    };
    assert.equal(latestEvidenceText(tip, "transcript"), "Flat tire.");
    assert.equal(latestEvidenceText(tip, "vision"), "The tire is flat.");
  });

  it("reads chat content from a string or parts", () => {
    assert.equal(chatContent({ choices: [{ message: { content: "A leak." } }] }), "A leak.");
    assert.equal(
      chatContent({ choices: [{ message: { content: [{ text: "A " }, { text: "leak." }] } }] }),
      "A leak.",
    );
  });
});
