#!/usr/bin/env bash
# Walk the confidence gauge: vague → drill-down → ordinary advice → hazard handoff.
# Prints scores and booleans only. Does not print the claim.
set -euo pipefail
export INTAKE_URL="${INTAKE_URL:-http://127.0.0.1:8787}"

node --input-type=module <<'EOF'
const base = process.env.INTAKE_URL || "http://127.0.0.1:8787";

async function create() {
  const res = await fetch(base + "/api/tickets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ region: "georgia" }),
  });
  if (!res.ok) throw new Error("create " + res.status);
  const body = await res.json();
  return { id: body.ticket_uuid, claim: body.claim };
}

async function patch(row, fields) {
  const res = await fetch(base + "/api/tickets/" + row.id, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-ticket-claim": row.claim },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error("patch " + res.status + " " + (await res.text()));
  return res.json();
}

async function batch(row, kbHit) {
  const res = await fetch(base + "/api/tickets/" + row.id + "/batch-review", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ticket-claim": row.claim },
    body: JSON.stringify({ kbHit }),
  });
  if (!res.ok) throw new Error("batch " + res.status + " " + (await res.text()));
  return res.json();
}

async function close(row) {
  const res = await fetch(base + "/api/tickets/" + row.id + "/close", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ticket-claim": row.claim },
    body: "{}",
  });
  if (!res.ok) throw new Error("close " + res.status);
}

function check(name, cond) {
  if (!cond) throw new Error("FAIL " + name);
  console.log("ok " + name);
}

const listCode = await fetch(base + "/api/tickets").then((r) => r.status);
check("private list stays hidden", listCode === 404);

const vague = await create();
try {
  const tip = await patch(vague, { title: "Help", description: "It is broken." });
  check("vague stays in questions", tip.confidence.phase === "understand" && tip.confidence.solution === null);
  check("vague asks what happened", tip.confidence.next === "What is happening, in one sentence?");
  const missing = await fetch(base + "/api/public/posts/" + vague.id);
  check("vague is not public", missing.status === 404);
} finally {
  await close(vague);
}

const sink = await create();
try {
  const partial = await patch(sink, { title: "Sink", description: "The kitchen sink is clogged." });
  check("sink asks when it started", partial.confidence.next === "When did it start?");
  const ready = await patch(sink, {
    description: "The kitchen sink is clogged since yesterday. I tried a plunger. I need it to drain.",
  });
  check("specific sink can be advised", ready.confidence.phase === "advise" && ready.confidence.solution >= 65);
  check("sink step mentions a plumber", /plumber/.test(ready.confidence.instruction));
  const reviewed = await batch(sink, false);
  check("confident sink is not handed to the public", reviewed.confidence.public === false);
  const hidden = await fetch(base + "/api/public/posts/" + sink.id);
  check("sink post is absent", hidden.status === 404);
} finally {
  await close(sink);
}

const gas = await create();
try {
  const tip = await patch(gas, {
    title: "Gas smell",
    description: "I smell gas in the kitchen since this morning. I need it to stop.",
  });
  check("gas warns", String(tip.coachLine).startsWith("Safety warning"));
  const handed = await batch(gas, true);
  check("gas stays with a person and off the board", handed.confidence.phase === "human" && handed.confidence.public === false);
  const hidden = await fetch(base + "/api/public/posts/" + gas.id);
  check("gas post is absent", hidden.status === 404);
} finally {
  await close(gas);
}

const wiring = await create();
try {
  const tip = await patch(wiring, {
    title: "Garage wiring",
    description: "I need to repair the electric wiring in my garage. It started this morning. Call me at 404-555-0199. I live at 18 Oak Street. Strip the wire and splice the hot to the neutral.",
  });
  check("wiring warns", String(tip.coachLine).startsWith("Safety warning"));
  check("wiring solution stays low", tip.confidence.phase === "batch" && tip.confidence.solution <= 28);
  check("wiring has no splice step", !/splice/i.test(tip.confidence.instruction || "") && !/splice/i.test(tip.fields.description.value));
  const before = await fetch(base + "/api/public/posts/" + wiring.id);
  check("wiring is private before the batch pass", before.status === 404);
  const handed = await batch(wiring, true);
  check("batch pass still hands wiring to a person", handed.confidence.phase === "human" && handed.confidence.public === true);
  check("backup model did not decide", handed.confidence.backup.used === false);
  const postRes = await fetch(base + "/api/public/posts/" + wiring.id);
  check("public post exists", postRes.status === 200);
  const post = await postRes.json();
  const blob = JSON.stringify(post);
  check("public id is the ticket uuid", post.ticket_uuid === wiring.id);
  check("claim is absent", !blob.includes(wiring.claim));
  check("phone and street are gone", !blob.includes("404-555-0199") && !blob.includes("18 Oak Street"));
  check("public post has no splice", !/splice/i.test(blob));
  const board = await fetch(base + "/api/public/posts").then((r) => r.json());
  const ids = (board.posts || []).map((p) => p.ticket_uuid);
  check("board lists the wiring post", ids.includes(wiring.id));
  check("board does not list the private sink", !ids.includes(sink.id));
  const bare = await fetch(base + "/api/tickets/" + wiring.id);
  check("uuid alone cannot read the private tip", bare.status === 401 || bare.status === 404);
} finally {
  await close(wiring);
  const gone = await fetch(base + "/api/public/posts/" + wiring.id);
  check("close removes the public post", gone.status === 404);
}

console.log("confidence e2e done");
EOF
