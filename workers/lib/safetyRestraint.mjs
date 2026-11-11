/**
 * Intake must warn on hazardous problems and must not give repair steps.
 * MyProblem does not verify that the work is safe.
 */

const PROCEDURAL =
  /\b(splice|strip the (wire|insulation)|connect the (hot|neutral|ground|wires?)|wire ?nuts?|pigtail|join the wires|fish the (wire|cable)|land the (wire|conductor)|turn the breaker back on)\b/i;

const RULES = [
  {
    id: "crisis",
    test: /\b(suicid|kill myself|hurt myself|end my life|don't want to live|do not want to live)\b/i,
  },
  {
    id: "hot_car",
    test: /\b(locked in (a |the )?(hot )?(car|vehicle)|child in a hot car|pet in a hot car|baby in the car)\b/i,
  },
  {
    id: "medical",
    test: /\b(chest pain|can'?t breathe|cannot breathe|not breathing|unconscious|won'?t wake|will not wake|seizure|overdos|stroke|coughing blood|severe bleeding|suicidal)\b/i,
  },
  {
    id: "fire",
    test: /\b(on fire|in flames|flames|smoke filling|room is filling with smoke|house is smoking)\b/i,
  },
  {
    id: "gas",
    test: /\b(gas leak|smell(s|ing)? gas|propane leak|carbon monoxide|\bCO alarm\b|CO detector)\b/i,
  },
  {
    id: "chemical",
    test: /\b(bleach and ammonia|mixed bleach|mixed ammonia|chemical burn|pesticide (in|on) (my|the) skin)\b/i,
  },
  {
    id: "water_electric",
    test: /\b(water|flood|rain|wet)\b[\s\S]{0,80}\b(breaker|electrical panel|outlet|socket|wiring|live wire)\b|\b(breaker|electrical panel|outlet|wiring)\b[\s\S]{0,80}\b(water|flood|wet)\b/i,
  },
  {
    id: "electrical",
    test: /\b(electric(al)? wiring|rewir\w*|electrician|breaker box|fuse box|circuit breaker|electrical panel|junction box|live wire|electrocut\w*|knob and tube|was shocked|got shocked|outlet is sparking|wiring in my garage|garage wiring)\b/i,
  },
  {
    id: "structural",
    test: /\b(ceiling (is )?(collaps\w*|falling|sagging)|wall is bowing|load[- ]bearing|floor is collapsing|foundation is collapsing)\b/i,
  },
  {
    id: "heights",
    test: /\b(on the roof|off the roof|up a ladder|on a ladder|two[- ]story ladder)\b/i,
  },
];

const COPY = {
  crisis: {
    coach:
      "Safety warning — crisis. If you may hurt yourself or someone else, call emergency services now. In the US and Canada call or text 988. MyProblem does not verify crisis advice.",
    warning:
      "Safety warning — crisis. If you may hurt yourself or someone else, call emergency services now. In the US and Canada call or text 988. MyProblem cannot keep you safe and does not verify crisis advice.",
    questions: ["Are you safe right now?", "Can you contact emergency services or 988?"],
  },
  hot_car: {
    coach:
      "Safety warning — hot car. If a person or animal is trapped, call emergency services now. MyProblem does not verify rescue steps.",
    warning:
      "Safety warning — hot car. If a person or animal is trapped in a vehicle, call emergency services now. MyProblem does not verify rescue steps.",
    questions: ["Is a person or animal still inside?", "Have you called emergency services?"],
  },
  medical: {
    coach:
      "Safety warning — medical. MyProblem is not emergency care and does not verify symptoms or treatment. If this may be life-threatening, call emergency services now.",
    warning:
      "Safety warning — medical. MyProblem is not a clinician and does not verify symptoms or treatment. If this may be life-threatening, call emergency services now.",
    questions: ["Is this an emergency right now?", "Have you called emergency services?"],
  },
  fire: {
    coach:
      "Safety warning — fire. Leave and call emergency services. MyProblem does not verify that the building is safe to enter.",
    warning:
      "Safety warning — fire. Leave and call emergency services. Do not stay to investigate. MyProblem does not verify that the building is safe to enter.",
    questions: ["Is everyone out?", "Have you called emergency services?"],
  },
  gas: {
    coach:
      "Safety warning — gas. Leave the area and call your utility or emergency services from outside. MyProblem does not verify that the air is safe.",
    warning:
      "Safety warning — gas or carbon monoxide. Leave the area. Do not switch lights or make flames. Call your gas utility or emergency services from outside. MyProblem is not a licensed gas technician and does not verify that the air is safe.",
    questions: ["Are you outside now?", "Have you called the gas utility or emergency services?"],
  },
  chemical: {
    coach:
      "Safety warning — chemicals. Get to fresh air. MyProblem does not verify that a mixture is safe. Call poison control or emergency services if someone was exposed.",
    warning:
      "Safety warning — chemicals. Get to fresh air. Do not mix more products. MyProblem does not verify that a mixture is safe. If someone was exposed, call poison control or emergency services.",
    questions: ["Is anyone having trouble breathing?", "Can you get to fresh air now?"],
  },
  water_electric: {
    coach:
      "Safety warning — water and electricity. Stay out. MyProblem does not verify this is safe. Call emergency services if water is in the panel.",
    warning:
      "Safety warning — water and electricity. Water and a live panel can kill. Stay out and do not touch the panel or standing water. MyProblem is not a licensed electrician and does not verify that this is safe. Call emergency services or a licensed electrician.",
    questions: ["Is anyone in the water near the panel?", "Have you stayed out of the room?"],
  },
  electrical: {
    coach:
      "Safety warning — electrical. MyProblem does not verify this is safe. Do not work on live wiring. If you see sparks, smell burning, or someone was shocked, leave and call emergency services.",
    warning:
      "Safety warning — electrical. MyProblem is not a licensed electrician and does not verify that this work is safe. Shock, arc, and fire can kill. Do not work on live wiring. If you smell burning, see sparks, or someone was shocked, leave and call emergency services. Otherwise stop and hire a licensed electrician.",
    questions: [
      "Is anyone hurt, or do you see sparks or smell burning?",
      "Do you need a licensed electrician instead of doing this yourself?",
    ],
  },
  structural: {
    coach:
      "Safety warning — structure. Leave if something is falling. MyProblem does not verify the building is safe.",
    warning:
      "Safety warning — structure. Leave if the ceiling, wall, or floor is moving or falling. MyProblem does not verify the building is safe. Use a licensed contractor or inspector before anyone goes back in.",
    questions: ["Is anyone still inside?", "Is the ceiling, wall, or floor still moving?"],
  },
  heights: {
    coach:
      "Safety warning — fall. MyProblem does not verify the roof or ladder is safe. A fall can kill.",
    warning:
      "Safety warning — fall. MyProblem does not verify that a roof or ladder is safe. Come down if you are unsure. A fall can kill. Hire a professional for roof work.",
    questions: ["Are you still on the roof or ladder?", "Can you come down before doing anything else?"],
  },
};

export function firstSafetyQuestion(hazard) {
  return COPY[hazard]?.questions?.[0] || "";
}

export function classifyHazard(text) {
  const blob = String(text || "");
  for (const rule of RULES) {
    if (rule.test.test(blob)) return rule.id;
  }
  return null;
}

export function stripProcedural(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence && !PROCEDURAL.test(sentence))
    .join(" ")
    .trim();
}

export function withWarning(description, warning) {
  const clean = stripProcedural(description);
  if (clean.includes("does not verify")) return clean.slice(0, 800);
  const room = Math.max(0, 800 - warning.length - 2);
  return `${warning}\n\n${clean.slice(0, room)}`.slice(0, 800);
}

/** Stamp a hazardous ticket. Returns the hazard id, or null. */
export function applySafetyRestraint(tip) {
  if (!tip) return null;
  const blob = [
    tip.fields?.title?.value,
    tip.fields?.description?.value,
    ...(tip.evidence || []).map((e) => e?.text || ""),
    ...(tip.questions || []),
  ].join("\n");
  const hazard = classifyHazard(blob);
  if (!hazard) return null;
  const copy = COPY[hazard];
  if (tip.fields?.description) {
    tip.fields.description = {
      ...tip.fields.description,
      value: withWarning(tip.fields.description.value || "", copy.warning),
    };
  }
  tip.coachLine = copy.coach;
  const extra = (tip.questions || []).filter((q) => q && !PROCEDURAL.test(q) && !copy.questions.includes(q));
  tip.questions = [...copy.questions, ...extra].slice(0, 3);
  tip.safety = { hazard, warned: true };
  tip.intake = "named_and_questions";
  return hazard;
}
