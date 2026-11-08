/**
 * Regional git tip store — text-only commits into georgia|israel worktrees.
 * No Neon. UUID capability; no public list API (listTipUuids is ops-local only).
 */
import { randomUUID, createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { issueClaim } from "./ticketAuth.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const REGIONS_ROOT = process.env.TICKETS_REGIONS_ROOT || join(ROOT, "regions");

export const REGIONS = ["georgia", "israel"];
export const HISTORY_RETENTION_MS = Number(process.env.TICKETS_HISTORY_RETENTION_MS || 48 * 60 * 60 * 1000);

export function regionRoot(region) {
  if (!REGIONS.includes(region)) throw new Error(`invalid_region:${region}`);
  const root = join(REGIONS_ROOT, region);
  if (!existsSync(join(root, ".git"))) {
    mkdirSync(join(root, "tickets"), { recursive: true });
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: root });
      execFileSync("git", ["config", "user.email", "intake@myproblem.app"], { cwd: root });
      execFileSync("git", ["config", "user.name", "MyProblem Intake"], { cwd: root });
      writeFileSync(join(root, "tickets", ".gitkeep"), "");
      execFileSync("git", ["add", "-A"], { cwd: root });
      execFileSync("git", ["commit", "-m", "chore: init regional tip repo"], { cwd: root });
    } catch {
      /* already initialized */
    }
  }
  return root;
}

function tipDir(region, uuid) {
  return join(regionRoot(region), "tickets", uuid);
}

function tipPath(region, uuid) {
  return join(tipDir(region, uuid), "tip.json");
}

function jobPath(region, uuid, jobId) {
  return join(tipDir(region, uuid), "jobs", `${jobId}.json`);
}

function git(region, args, opts = {}) {
  return execFileSync("git", args, {
    cwd: regionRoot(region),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

export function emptyTip(id, region) {
  const now = Date.now();
  return {
    schema: "myproblem.ticket.tip.v1",
    ticket_uuid: id,
    region,
    claim: issueClaim(),
    preserve: false,
    createdAtMs: now,
    updatedAtMs: now,
    status: "open",
    fields: {
      title: { value: "Listening…", source: "intake", locked: false },
      description: { value: "", source: "intake", locked: false },
    },
    coachLine: "Please state your problem.",
    intake: "listening",
    questions: [],
    evidence: [],
    jobs: [],
    timeline: [{ id: randomUUID(), kind: "system", body: "Ticket opened", atMs: now }],
  };
}

export function loadTip(region, uuid) {
  const p = tipPath(region, uuid);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Find tip by UUID across regions (exact id only — not a list API). */
export function loadTipAnyRegion(uuid) {
  for (const region of REGIONS) {
    const tip = loadTip(region, uuid);
    if (tip) return { tip, region };
  }
  return null;
}

function writeIndexMd(tip) {
  const title = tip.fields?.title?.value || "Ticket";
  const desc = tip.fields?.description?.value || "";
  return `# ${title}\n\n${desc}\n\n_intake: ${tip.intake}_ · _status: ${tip.status}_\n`;
}

export function saveTip(region, tip, intent = "update") {
  tip.region = region;
  tip.updatedAtMs = Date.now();
  const dir = tipDir(region, tip.ticket_uuid);
  mkdirSync(join(dir, "jobs"), { recursive: true });
  writeFileSync(tipPath(region, tip.ticket_uuid), JSON.stringify(tip, null, 2) + "\n");
  writeFileSync(join(dir, "index.md"), writeIndexMd(tip));
  // Sync job files from tip.jobs denormalized mirror
  for (const j of tip.jobs || []) {
    const jp = jobPath(region, tip.ticket_uuid, j.id);
    writeFileSync(
      jp,
      JSON.stringify(
        {
          id: j.id,
          ticket_uuid: tip.ticket_uuid,
          bin: j.bin,
          state: j.state,
          payload: j.payload || {},
          updatedAtMs: tip.updatedAtMs,
        },
        null,
        2,
      ) + "\n",
    );
  }
  git(region, ["add", `tickets/${tip.ticket_uuid}`]);
  try {
    git(region, ["commit", "-m", `ticket(${tip.ticket_uuid}): ${intent}`]);
  } catch (e) {
    // nothing to commit
    if (!String(e.stderr || e.message || e).includes("nothing to commit")) throw e;
  }
  return tip;
}

export function createTicket(region) {
  const id = randomUUID();
  const tip = emptyTip(id, region);
  return saveTip(region, tip, "create");
}

export function enqueueJob(region, tip, bin, payload = {}) {
  const id = randomUUID();
  const job = { id, bin, state: "queued", payload };
  tip.jobs = tip.jobs || [];
  tip.jobs.push({ id, bin, state: "queued", payload });
  saveTip(region, tip, `enqueue-${bin}`);
  return job;
}

export function setJobState(region, tip, jobId, state) {
  tip.jobs = (tip.jobs || []).map((j) => (j.id === jobId ? { ...j, state } : j));
  const jp = jobPath(region, tip.ticket_uuid, jobId);
  if (existsSync(jp)) {
    const cur = JSON.parse(readFileSync(jp, "utf8"));
    cur.state = state;
    cur.updatedAtMs = Date.now();
    writeFileSync(jp, JSON.stringify(cur, null, 2) + "\n");
  }
  saveTip(region, tip, `job-${state}`);
}

/** Ops-only: scan worktree for queued jobs (never exposed as HTTP list). */
export function scanQueuedJobs(limit = 50) {
  const out = [];
  for (const region of REGIONS) {
    const ticketsDir = join(regionRoot(region), "tickets");
    if (!existsSync(ticketsDir)) continue;
    for (const uuid of readdirSync(ticketsDir)) {
      const jobsDir = join(ticketsDir, uuid, "jobs");
      if (!existsSync(jobsDir) || !statSync(jobsDir).isDirectory()) continue;
      for (const f of readdirSync(jobsDir)) {
        if (!f.endsWith(".json")) continue;
        const job = JSON.parse(readFileSync(join(jobsDir, f), "utf8"));
        if (job.state !== "queued") continue;
        out.push({ region, ticket_uuid: uuid, ...job });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

export function countQueuedByBin() {
  const counts = { asr: 0, vision: 0, project: 0, intake: 0 };
  let oldestAgeHours = 0;
  const now = Date.now();
  for (const j of scanQueuedJobs(10_000)) {
    if (counts[j.bin] != null) counts[j.bin]++;
    const ageH = (now - (j.updatedAtMs || now)) / 3600000;
    if (ageH > oldestAgeHours) oldestAgeHours = ageH;
  }
  return { ...counts, oldestAgeHours };
}

/**
 * Close tip: delete tree unless preserve.
 * Returns { purged: boolean, tip?: tip }.
 */
export function closeTicket(region, uuid) {
  const tip = loadTip(region, uuid);
  if (!tip) return { purged: false, error: "not_found" };
  if (tip.preserve) {
    tip.status = "closed";
    saveTip(region, tip, "close-preserved");
    return { purged: false, tip };
  }
  const dir = tipDir(region, uuid);
  rmSync(dir, { recursive: true, force: true });
  git(region, ["add", "-A", `tickets/${uuid}`]);
  try {
    git(region, ["commit", "-m", `ticket(${uuid}): purge-on-close`]);
  } catch (e) {
    if (!String(e.stderr || e.message || e).includes("nothing to commit")) throw e;
  }
  return { purged: true };
}

export function setPreserve(region, uuid, preserve) {
  const tip = loadTip(region, uuid);
  if (!tip) return null;
  tip.preserve = Boolean(preserve);
  return saveTip(region, tip, preserve ? "preserve" : "unpreserve");
}

/**
 * Ditch history older than retention by orphaning a fresh root commit of current tree.
 * Ops-local; does not expose UUID lists over HTTP.
 */
export function trimHistory(region) {
  const root = regionRoot(region);
  if (!existsSync(join(root, ".git"))) return { ok: false, error: "no_git" };
  // Only trim if HEAD is older than retention window (commit time)
  let headAge = 0;
  try {
    const ts = git(region, ["log", "-1", "--format=%ct"]).trim();
    headAge = Date.now() - Number(ts) * 1000;
  } catch {
    return { ok: true, skipped: "empty" };
  }
  // Always allow trim when env forces; otherwise run if any commit older than retention exists
  let oldest = headAge;
  try {
    const ts = git(region, ["log", "--reverse", "-1", "--format=%ct"]).trim();
    oldest = Date.now() - Number(ts) * 1000;
  } catch {
    /* ignore */
  }
  if (oldest < HISTORY_RETENTION_MS) {
    return { ok: true, skipped: "within_retention", oldestMs: oldest };
  }
  // Orphan soft reset: new root with current tree
  git(region, ["checkout", "--orphan", "retention-trim"]);
  git(region, ["add", "-A"]);
  try {
    git(region, ["commit", "-m", `chore: retention trim (${HISTORY_RETENTION_MS}ms window)`]);
  } catch (e) {
    if (!String(e.stderr || e.message || e).includes("nothing to commit")) throw e;
  }
  git(region, ["branch", "-M", "main"]);
  try {
    git(region, ["gc", "--prune=now"]);
  } catch {
    /* optional */
  }
  return { ok: true, trimmed: true };
}

export function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
