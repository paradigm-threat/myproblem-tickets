/**
 * Regional git tip store — text-only commits into georgia|israel worktrees.
 * No Neon. UUID capability; no public list API (listTipUuids is ops-local only).
 */
import { randomUUID, createHash, randomBytes } from "node:crypto";
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
/** Default live-slug TTL (30 days). */
export const LIVE_SLUG_TTL_MS = Number(process.env.LIVE_SLUG_TTL_MS || 30 * 24 * 60 * 60 * 1000);

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function mintSlugToken(bytes = 5) {
  const buf = randomBytes(bytes);
  let out = "";
  for (const b of buf) out += SLUG_ALPHABET[b % 32];
  return out;
}

function liveSlugsPath(region) {
  return join(regionRoot(region), "live-slugs.json");
}

function readLiveSlugs(region) {
  const p = liveSlugsPath(region);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeLiveSlugs(region, map, intent = "live-slugs") {
  const p = liveSlugsPath(region);
  writeFileSync(p, JSON.stringify(map, null, 2) + "\n");
  git(region, ["add", "live-slugs.json"]);
  try {
    git(region, ["commit", "-m", `meta: ${intent}`]);
  } catch (e) {
    if (!String(e.stderr || e.message || e).includes("nothing to commit")) throw e;
  }
}

/**
 * Normalize a topical SI-suggested slug (kebab-case). Empty if invalid.
 * Prefer topic + originality; never accept PII-looking tokens here (caller filters).
 */
export function normalizeTopicalSlug(raw) {
  const slug = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug || slug.length < 4) return null;
  if (/^\d+$/.test(slug)) return null;
  return slug;
}

/** List live slug keys across regions (for originality checks). */
export function listLiveSlugKeys() {
  const keys = new Set();
  for (const region of REGIONS) {
    for (const k of Object.keys(readLiveSlugs(region))) keys.add(k);
  }
  return [...keys];
}

/**
 * Allocate a live slug. Prefer `preferred` topical slug from SI when unique;
 * otherwise mint a random token. Map stays private (not world-readable).
 */
export function mintLiveSlug(region, ticketUuid, ttlMs = LIVE_SLUG_TTL_MS, preferred = null) {
  const map = readLiveSlugs(region);
  const all = new Set(listLiveSlugKeys());
  let slug = normalizeTopicalSlug(preferred);
  if (slug && all.has(slug)) {
    let n = 2;
    while (all.has(`${slug}-${n}`) && n < 50) n += 1;
    slug = all.has(`${slug}-${n}`) ? null : `${slug}-${n}`;
  }
  if (!slug) {
    slug = mintSlugToken();
    let guard = 0;
    while (all.has(slug) && guard < 20) {
      slug = mintSlugToken();
      guard += 1;
    }
  }
  if (all.has(slug) || map[slug]) throw new Error("slug_collision");
  const now = Date.now();
  map[slug] = {
    ticket_uuid: ticketUuid,
    createdAtMs: now,
    expiresAtMs: now + ttlMs,
    topical: Boolean(normalizeTopicalSlug(preferred)),
  };
  writeLiveSlugs(region, map, `slug-mint(${slug})`);
  return slug;
}

/** Replace tip live slug with a topical SI suggestion (human may have edited). */
export function setLiveSlug(region, tip, preferred, ttlMs = LIVE_SLUG_TTL_MS) {
  if (tip.live_slug) dropLiveSlug(region, tip.live_slug);
  const slug = mintLiveSlug(region, tip.ticket_uuid, ttlMs, preferred);
  tip.live_slug = slug;
  tip.updatedAtMs = Date.now();
  return saveTip(region, tip, `slug-set(${slug})`);
}

/** Resolve one slug → { region, ticket_uuid, slug, entry }. No bulk list API. */
export function resolveLiveSlug(slug) {
  const key = String(slug || "").trim().toLowerCase();
  if (!key || key.length < 4) return null;
  const now = Date.now();
  for (const region of REGIONS) {
    const map = readLiveSlugs(region);
    const entry = map[key];
    if (!entry?.ticket_uuid) continue;
    if (entry.expiresAtMs && entry.expiresAtMs < now) {
      delete map[key];
      writeLiveSlugs(region, map, `slug-expire(${key})`);
      return null;
    }
    return { region, ticket_uuid: entry.ticket_uuid, slug: key, entry };
  }
  return null;
}

/** Drop slug from private map (privacy kill switch for public permalink). */
export function dropLiveSlug(region, slugOrUuid) {
  const map = readLiveSlugs(region);
  let removed = null;
  const needle = String(slugOrUuid || "").trim();
  for (const [slug, entry] of Object.entries(map)) {
    if (slug === needle || entry?.ticket_uuid === needle) {
      delete map[slug];
      removed = slug;
      break;
    }
  }
  if (!removed) return false;
  writeLiveSlugs(region, map, `slug-drop(${removed})`);
  return true;
}

/**
 * Batch-only: set tip resolution. On solved, drop live slug.
 * Callers must gate with ops/API secret — never accept from anon clients.
 */
export function setTipResolution(region, uuid, resolution) {
  if (resolution !== "solved" && resolution !== "unsolved") {
    throw new Error("invalid_resolution");
  }
  const tip = loadTip(region, uuid);
  if (!tip) return null;
  tip.resolution = resolution;
  if (resolution === "solved") {
    if (tip.live_slug) dropLiveSlug(region, tip.live_slug);
    tip.live_slug = null;
    tip.timeline = tip.timeline || [];
    tip.timeline.push({
      id: randomUUID(),
      kind: "system",
      body: "SI marked this problem solved",
      atMs: Date.now(),
    });
  }
  return saveTip(region, tip, `resolution-${resolution}`);
}

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

export function emptyTip(id, region, opts = {}) {
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
    resolution: "unsolved",
    raiser_visitor_id: opts.raiser_visitor_id ?? null,
    live_slug: opts.live_slug ?? null,
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
  const resolution = tip.resolution || "unsolved";
  return `# ${title}\n\n${desc}\n\n_intake: ${tip.intake}_ · _status: ${tip.status}_ · _resolution: ${resolution}_\n`;
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

/**
 * Create tip. `mint_slug` defaults true (APK mint-on-create).
 * Web submit passes mint_slug: false, then opt-in via suggest-slug apply.
 */
export function createTicket(region, opts = {}) {
  const id = randomUUID();
  const mintSlug = opts.mint_slug !== false;
  const slug = mintSlug ? mintLiveSlug(region, id) : null;
  const tip = emptyTip(id, region, {
    raiser_visitor_id: opts.raiser_visitor_id ?? null,
    live_slug: slug,
  });
  return saveTip(region, tip, "create");
}

/** Clear public live slug; tip stays private (claim still works). */
export function unpublishLiveSlug(region, tip) {
  if (!tip) return null;
  if (tip.live_slug) dropLiveSlug(region, tip.live_slug);
  tip.live_slug = null;
  tip.updatedAtMs = Date.now();
  return saveTip(region, tip, "unpublish-slug");
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
export function scanQueuedJobs(limit = 50, skipBins = []) {
  const out = [];
  const skip = new Set(skipBins);
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
        if (skip.has(job.bin)) continue;
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
function publicPath(region, uuid) {
  return join(regionRoot(region), "public", `${uuid}.json`);
}

/** Redacted board entry. Not a private ticket and not a claim. */
export function savePublicPost(region, post) {
  if (!post?.ticket_uuid) throw new Error("public_post_requires_uuid");
  const dir = join(regionRoot(region), "public");
  mkdirSync(dir, { recursive: true });
  writeFileSync(publicPath(region, post.ticket_uuid), JSON.stringify(post, null, 2) + "\n");
  git(region, ["add", `public/${post.ticket_uuid}.json`]);
  try {
    git(region, ["commit", "-m", `public(${post.ticket_uuid}): publish`]);
  } catch (e) {
    if (!String(e.stderr || e.message || e).includes("nothing to commit")) throw e;
  }
  return post;
}

export function loadPublicPost(uuid) {
  for (const region of REGIONS) {
    const p = publicPath(region, uuid);
    if (!existsSync(p)) continue;
    return JSON.parse(readFileSync(p, "utf8"));
  }
  return null;
}

/** Published posts only. Never a list of private tickets. */
export function listPublicPosts() {
  const out = [];
  for (const region of REGIONS) {
    const dir = join(regionRoot(region), "public");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const post = JSON.parse(readFileSync(join(dir, name), "utf8"));
      out.push({
        ticket_uuid: post.ticket_uuid,
        title: post.title || "",
        region: post.region || region,
      });
    }
  }
  return out;
}

export function removePublicPost(region, uuid) {
  const p = publicPath(region, uuid);
  if (!existsSync(p)) return false;
  rmSync(p, { force: true });
  git(region, ["add", "-A", `public/${uuid}.json`]);
  try {
    git(region, ["commit", "-m", `public(${uuid}): unpublish`]);
  } catch (e) {
    if (!String(e.stderr || e.message || e).includes("nothing to commit")) throw e;
  }
  return true;
}

export function closeTicket(region, uuid) {
  const tip = loadTip(region, uuid);
  if (!tip) return { purged: false, error: "not_found" };
  dropLiveSlug(region, tip.live_slug || uuid);
  if (!tip.preserve) removePublicPost(region, uuid);
  if (tip.preserve) {
    tip.status = "closed";
    tip.live_slug = null;
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
