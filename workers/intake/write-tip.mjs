#!/usr/bin/env node
/**
 * Local/dev tip writer — Intake owns mutations in production.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function parseArgs(argv) {
  const out = { id: null, title: "New problem", description: "" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--id") out.id = argv[++i];
    else if (argv[i] === "--title") out.title = argv[++i];
    else if (argv[i] === "--description") out.description = argv[++i];
  }
  return out;
}

function emptyTip(id, title, description) {
  const now = Date.now();
  return {
    schema: "myproblem.ticket.tip.v1",
    ticket_uuid: id,
    claim: null,
    createdAtMs: now,
    updatedAtMs: now,
    status: "open",
    fields: {
      title: { value: title, source: "intake", locked: false },
      description: { value: description, source: "intake", locked: false },
    },
    coachLine: "Please state your problem.",
    intake: "listening",
    questions: [],
    evidence: [],
    jobs: [],
    timeline: [
      {
        id: randomUUID(),
        kind: "system",
        body: "Ticket opened (audio/text)",
        atMs: now,
      },
    ],
  };
}

const args = parseArgs(process.argv);
const id = args.id || randomUUID();
const dir = join(ROOT, "tickets", id);
mkdirSync(dir, { recursive: true });
const path = join(dir, "tip.json");
const tip = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : emptyTip(id, args.title, args.description);
if (args.title) tip.fields.title.value = args.title;
if (args.description) tip.fields.description.value = args.description;
tip.updatedAtMs = Date.now();
writeFileSync(path, JSON.stringify(tip, null, 2) + "\n");
console.log(JSON.stringify({ ticket_uuid: id, path }, null, 2));
