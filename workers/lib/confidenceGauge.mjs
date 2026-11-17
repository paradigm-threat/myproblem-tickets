/**
 * Requirements confidence for intake.
 * Understanding: keep one deductive question until the problem is specific.
 * Solution: only then, how likely a short next step is to be clear.
 * Below the solution threshold we do not advise. The batch pass may try once.
 * If that pass is also unsure, a person continues and a redacted post is public.
 * Backup models (Grok and others) may clarify wording or a still later.
 * They do not decide this gauge and they do not widen the product past
 * problem solving and requirements.
 */
import { classifyHazard, firstSafetyQuestion, stripProcedural } from "./safetyRestraint.mjs";
import { convertPii } from "./piiConvert.mjs";

export const ORDINARY_READY = 80;
export const HAZARD_READY = 70;
export const SOLUTION_READY = 65;
export const HAZARD_SOLUTION_CAP = 28;

const WHAT =
  /\b(flat tire|tire|sink|drain|clog|wiring|wire|breaker|outlet|alarm|chirp|smoke|gas|leak|lock|locked out|router|wifi|ceiling|ladder|roof|pump|belt|door|fridge|error code|flames|on fire|chest pain|chemical)\b/i;
const WHERE =
  /\b(garage|kitchen|roadside|bathroom|hallway|panel|trunk|bedroom|basement|driveway|office|yard|car|house|roof)\b/i;
const WHEN =
  /\b(since|yesterday|today|this morning|this afternoon|started|just now|last night|hours|minutes ago|for \d+)\b/i;
const TRIED = /\b(i tried|already tried|i checked|i used|i replaced|i called|did not work|didn't work)\b/i;
const OUTCOME = /\b(i need|i want|so i can|need it to|so that|i need to)\b/i;
const AMBIGUOUS = /\b(maybe|not sure|either)\b/i;

export const OPENING_ASK = "What is happening, in one sentence?";
export const KEEP_SHOWING = "Keep showing the problem, or stop when you are done.";

const CAMERA_ASK =
  /\b(look closer|closer look|which object|show the|another (?:photo|angle|look)|photo of)\b/i;

const QUESTIONS = {
  what: "What is happening, in one sentence?",
  where: "Where is this happening?",
  when: "When did it start?",
  tried: "What have you already tried?",
  outcome: "What does fixed look like?",
};

const HAZARD_QUESTIONS = {
  where: "Which room is this in? Leave out the street address.",
  when: "When did this start?",
  outcome: "Are you trying to record what happened, or do you need a licensed person?",
};

const IMMEDIATE = new Set([
  "crisis",
  "hot_car",
  "medical",
  "fire",
  "gas",
  "chemical",
  "water_electric",
  "structural",
  "heights",
]);

const PATTERNS = [
  {
    id: "flat_tire",
    test: /\bflat tire\b/i,
    score: 82,
    instruction:
      "Next step: if you can, move out of the lane. Use the spare if you have one, or call roadside service. Stop if the car is not stable.",
  },
  {
    id: "clogged_sink",
    test: /\b(clog\w*|won'?t drain|will not drain|backed up)\b/i,
    score: 76,
    instruction:
      "Next step: stop adding water. A plunger is the usual first try. If it is overflowing or a plunger already failed, shut the water off and have a plumber look. Do not mix drain chemicals.",
  },
  {
    id: "chirp_alarm",
    test: /\bchirp/i,
    score: 80,
    instruction:
      "Next step: if there is no smoke and no fire, a chirp is often a low battery. Replace the battery, or the alarm if it is past its date. If you smell smoke, leave and call emergency services.",
  },
  {
    id: "locked_out",
    test: /\blocked out\b/i,
    score: 74,
    instruction:
      "Next step: use a spare key you already have, or call a locksmith. We do not provide ways to force a lock.",
  },
];

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function problemText(tip) {
  return [tip?.fields?.title?.value, tip?.fields?.description?.value, ...(tip?.evidence || []).map((e) => e?.text || "")]
    .filter(Boolean)
    .join("\n");
}

/** Drop the warning we attached so its own words are not read as the event. */
function withoutOurWarning(text) {
  return String(text || "")
    .split(/\n+/)
    .filter((line) => !/^\s*Safety warning\b/i.test(line))
    .join("\n");
}

export function readSlots(text) {
  return {
    what: WHAT.test(text),
    where: WHERE.test(text),
    when: WHEN.test(text),
    tried: TRIED.test(text),
    outcome: OUTCOME.test(text),
  };
}

export function understandingScore(slots) {
  let score = 0;
  if (slots.what) score += 30;
  if (slots.where) score += 15;
  if (slots.when) score += 10;
  if (slots.tried) score += 15;
  if (slots.outcome) score += 15;
  return score;
}

function nextSlot(slots, hazard) {
  const order = hazard
    ? ["what", "where", "when", "outcome"]
    : ["what", "where", "when", "tried", "outcome"];
  return order.find((key) => !slots[key]) || null;
}

function questionFor(slot, hazard) {
  if (!slot) return "";
  if (hazard && HAZARD_QUESTIONS[slot]) return HAZARD_QUESTIONS[slot];
  return QUESTIONS[slot] || "";
}

function knownPattern(text, hazard) {
  if (hazard) return null;
  return PATTERNS.find((p) => p.test.test(text)) || null;
}

function genericQuestions() {
  return new Set([...Object.values(QUESTIONS), ...Object.values(HAZARD_QUESTIONS)]);
}

function isCameraAsk(q) {
  return CAMERA_ASK.test(String(q || ""));
}

function placeQuestion(tip, next) {
  const generics = genericQuestions();
  const kept = (tip.questions || []).filter((q) => q && !generics.has(q));
  tip.questions = next ? [...kept, next].slice(0, 3) : kept.slice(0, 3);
}

/** The one sentence the capture screen shows. */
export function chooseAsk(tip, gauge) {
  const generics = genericQuestions();
  const extras = (tip?.questions || []).filter((q) => q && !generics.has(q));
  if (gauge?.hazard || tip?.safety?.warned) {
    const safe = extras.find((q) => !isCameraAsk(q));
    return safe || firstSafetyQuestion(gauge?.hazard || tip?.safety?.hazard) || extras[0] || "";
  }
  if (gauge?.next) return gauge.next;
  if (extras[0]) return extras[0];
  if ((gauge?.understanding || 0) > 0) return KEEP_SHOWING;
  return OPENING_ASK;
}

/** A clip uploaded while the person is still talking. Keep the session and the current ask. */
export function noteRollingClip(tip) {
  if (!tip) return tip;
  const safety = String(tip.coachLine || "").startsWith("Safety warning");
  const ask = tip.confidence?.ask;
  if (!safety && !ask) {
    tip.coachLine = "Listening — transcribing what you just said.";
  }
  if (!tip.intake || tip.intake === "listening") tip.intake = "queued";
  return tip;
}

function lineFor(gauge) {
  if (gauge.phase === "understand") {
    return `Understanding ${gauge.understanding}%. ${gauge.next}`;
  }
  if (gauge.phase === "advise") {
    return `Solution ${gauge.solution}%. Confident enough for a next step.`;
  }
  if (gauge.phase === "human") {
    if (gauge.public === false) {
      return `Solution ${gauge.solution}%. Not confident advising further. A person should continue. This stays private.`;
    }
    return `Solution ${gauge.solution}%. Not confident advising further. A person should continue. The redacted post is public.`;
  }
  return `Solution ${gauge.solution}%. Not confident enough to advise further. Post this ticket so the batch pass can try.`;
}

/** Score the tip and attach tip.confidence. Does not publish. */
export function applyConfidence(tip) {
  if (!tip) return null;
  const text = problemText(tip);
  const hazard = classifyHazard(text);
  const slots = readSlots(text);
  const understanding = understandingScore(slots);
  const prior = tip.confidence || {};
  const pattern = knownPattern(text, hazard);
  const userText = withoutOurWarning(text);
  const immediate =
    IMMEDIATE.has(hazard) ||
    (hazard === "electrical" && /\b(shocked|sparks?|burning)\b/i.test(userText));
  const readyAt = hazard ? HAZARD_READY : ORDINARY_READY;
  const understandingReady = immediate || understanding >= readyAt;

  let solution = null;
  let phase = "understand";
  let instruction = "";
  let next = "";

  if (!understandingReady) {
    const slot = nextSlot(slots, hazard);
    next = questionFor(slot, hazard);
    phase = "understand";
  } else {
    solution = pattern ? pattern.score : 32;
    if (AMBIGUOUS.test(text)) solution -= 25;
    if (hazard) solution = Math.min(solution, HAZARD_SOLUTION_CAP);
    solution = clamp(solution);
    if (!hazard && solution >= SOLUTION_READY && pattern) {
      phase = "advise";
      instruction = pattern.instruction;
    } else {
      phase = "batch";
      instruction = "";
    }
  }

  let published = false;
  if (prior.batchTried && prior.phase === "human" && phase === "batch") {
    phase = "human";
    published = !immediate;
  }
  if (phase === "advise") published = false;

  const gauge = {
    understanding,
    solution,
    phase,
    hazard: hazard || null,
    immediate,
    pattern: pattern?.id || null,
    understandThreshold: hazard ? HAZARD_READY : ORDINARY_READY,
    solutionThreshold: SOLUTION_READY,
    next,
    instruction,
    public: published,
    batchTried: Boolean(prior.batchTried),
    backup: prior.backup || null,
    line: "",
  };
  gauge.line = lineFor(gauge);
  tip.confidence = gauge;
  placeQuestion(tip, phase === "understand" ? next : "");
  if (gauge.hazard) {
    tip.questions = (tip.questions || []).filter((q) => !isCameraAsk(q));
  }
  gauge.ask = chooseAsk(tip, gauge);
  if (phase === "advise" && instruction && tip.fields?.description) {
    const current = String(tip.fields.description.value || "");
    if (!current.includes(instruction)) {
      tip.fields.description = {
        ...tip.fields.description,
        value: `${current}\n\n${instruction}`.trim().slice(0, 800),
      };
    }
  }
  const safetyCoach = String(tip.coachLine || "").startsWith("Safety warning");
  if (!safetyCoach) tip.coachLine = gauge.line;
  if (phase === "understand" || phase === "advise") {
    if (!tip.safety?.warned) tip.intake = "named_and_questions";
  } else if (!immediate || understandingReady) {
    tip.intake = "queue_project";
  }
  return gauge;
}

/**
 * Batch tier. A knowledge-base hit can lift a known ordinary pattern.
 * It cannot lift a hazard over the cap, and it does not invent steps.
 * Backup models are recorded as unused unless a later worker calls them.
 */
export function applyBatchReview(tip, { kbHit = false } = {}) {
  applyConfidence(tip);
  const gauge = tip.confidence;
  gauge.batchTried = true;
  gauge.backup = {
    role: "backup",
    providers: ["grok"],
    used: false,
    reason:
      "A backup model may help with clearer wording or a better image read. The gauge still decides. The product stays on problem solving and requirements.",
  };
  if (gauge.phase === "understand" || gauge.phase === "advise") {
    gauge.public = false;
    return gauge;
  }
  if (kbHit && gauge.pattern && !gauge.hazard) {
    gauge.solution = clamp(gauge.solution + 20);
    if (gauge.solution >= SOLUTION_READY) {
      const pattern = PATTERNS.find((p) => p.id === gauge.pattern);
      gauge.phase = "advise";
      gauge.instruction = pattern?.instruction || "";
      gauge.public = false;
      gauge.ask = chooseAsk(tip, gauge);
      gauge.line = `Solution ${gauge.solution}%. The batch pass found a matching note.`;
      if (!String(tip.coachLine || "").startsWith("Safety warning")) tip.coachLine = gauge.line;
      if (!tip.safety?.warned) tip.intake = "named_and_questions";
      return gauge;
    }
  }
  gauge.phase = "human";
  gauge.public = !gauge.immediate && !IMMEDIATE.has(gauge.hazard);
  gauge.instruction = "";
  gauge.ask = chooseAsk(tip, gauge);
  gauge.line = lineFor(gauge);
  if (!String(tip.coachLine || "").startsWith("Safety warning")) tip.coachLine = gauge.line;
  tip.intake = "queue_project";
  return gauge;
}

/** Whitelist projection. No claim. Only scrubbed/pilot media URIs. PII coarsened; repair steps removed. */
export function toPublicPost(tip) {
  const title = stripProcedural(convertPii(tip?.fields?.title?.value || "").text);
  const description = stripProcedural(convertPii(tip?.fields?.description?.value || "").text);
  const media = (tip.evidence || [])
    .filter(
      (e) =>
        e.kind === "still" &&
        e.uri &&
        (e.choice === true || e.scrubbed === true) &&
        (e.scrubbed === true ||
          String(e.uri).includes("b-cdn.net") ||
          String(e.uri).startsWith("/pilot/")),
    )
    .map((e) => ({ id: e.id, uri: e.uri, choice: e.choice === true }));
  return {
    schema: "myproblem.public.post.v1",
    ticket_uuid: tip.ticket_uuid,
    region: tip.region,
    slug: tip.live_slug || null,
    title,
    description,
    media,
    confidence: {
      understanding: tip.confidence?.understanding ?? null,
      solution: tip.confidence?.solution ?? null,
      phase: "human",
    },
    note: "A person should continue this investigation. MyProblem was not confident advising further. Contact details are not on this post. All tickets are anonymized but may be used to train the SI (Super Intelligence, i.e. AI).",
    publishedAtMs: Date.now(),
  };
}
