#!/usr/bin/env node
/**
 * Intake wake loop stub: if Neon GPU bins are ready, print Spot create steps.
 * Production: call Rackspace Spot API (createCloudspace / createSpotNodePool).
 *
 * Env:
 *   DATABASE_URL — Neon
 *   SPOT_TOKEN — Rackspace Spot API token (never commit)
 *   WAKE_ASR_MIN — default 1
 *   WAKE_MAX_AGE_HOURS — default 24
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadThresholds() {
  return {
    asrMin: Number(process.env.WAKE_ASR_MIN || 1),
    visionMin: Number(process.env.WAKE_VISION_MIN || 1),
    projectMin: Number(process.env.WAKE_PROJECT_MIN || 1),
    maxAgeHours: Number(process.env.WAKE_MAX_AGE_HOURS || 24),
  };
}

/** Pure decision helper — unit-testable without Spot. */
export function shouldWakeBatch(counts, oldestAgeHours, thr = loadThresholds()) {
  if (counts.asr >= thr.asrMin || counts.vision >= thr.visionMin || counts.project >= thr.projectMin) {
    return { wake: true, reason: "depth" };
  }
  if (oldestAgeHours != null && oldestAgeHours >= thr.maxAgeHours && (counts.asr + counts.vision + counts.project) > 0) {
    return { wake: true, reason: "age" };
  }
  return { wake: false, reason: "quiet" };
}

async function countQueuedFromEnv() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Dev fallback: look for local marker file written by eval/enqueue
    const marker = join(__dirname, "../../.wake-counts.json");
    if (existsSync(marker)) return JSON.parse(readFileSync(marker, "utf8"));
    return { asr: 0, vision: 0, project: 0, intake: 0, oldestAgeHours: 0 };
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  const rows = await sql`
    SELECT bin, COUNT(*)::int AS n,
           EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 3600.0 AS oldest_h
    FROM ticket_jobs
    WHERE state = 'queued' AND bin IN ('asr', 'vision', 'project', 'intake')
    GROUP BY bin
  `;
  const counts = { asr: 0, vision: 0, project: 0, intake: 0 };
  let oldestAgeHours = 0;
  for (const r of rows) {
    counts[r.bin] = r.n;
    oldestAgeHours = Math.max(oldestAgeHours, Number(r.oldest_h) || 0);
  }
  return { ...counts, oldestAgeHours };
}

async function main() {
  const counts = await countQueuedFromEnv();
  const decision = shouldWakeBatch(counts, counts.oldestAgeHours);
  console.log(JSON.stringify({ counts, decision }, null, 2));
  if (!decision.wake) {
    console.log("No wake.");
    return;
  }
  if (!process.env.SPOT_TOKEN) {
    console.log(
      "Would wake myproblem-batch (SJC A30). Set SPOT_TOKEN and run infra/scripts/spot-wake-batch.sh",
    );
    return;
  }
  console.log("SPOT_TOKEN set — invoke infra/scripts/spot-wake-batch.sh");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
