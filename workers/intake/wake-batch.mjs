/**
 * Intake wake loop: if regional git job files are queued, wake Batch Spot.
 * No Neon / DATABASE_URL.
 *
 * Env:
 *   SPOT_TOKEN — Rackspace Spot API token (never commit)
 *   WAKE_ASR_MIN — default 1
 *   WAKE_MAX_AGE_HOURS — default 24
 */
import { countQueuedByBin } from "../lib/gitTipStore.mjs";

function loadThresholds() {
  return {
    asrMin: Number(process.env.WAKE_ASR_MIN || 1),
    visionMin: Number(process.env.WAKE_VISION_MIN || 1),
    projectMin: Number(process.env.WAKE_PROJECT_MIN || 1),
    mediaMin: Number(process.env.WAKE_MEDIA_MIN || 1),
    maxAgeHours: Number(process.env.WAKE_MAX_AGE_HOURS || 24),
  };
}

/** Pure decision helper — unit-testable without Spot. */
export function shouldWakeBatch(counts, oldestAgeHours, thr = loadThresholds()) {
  if (
    counts.asr >= thr.asrMin ||
    counts.vision >= thr.visionMin ||
    counts.project >= thr.projectMin ||
    (counts.media || 0) >= thr.mediaMin
  ) {
    return { wake: true, reason: "depth" };
  }
  const depth =
    (counts.asr || 0) + (counts.vision || 0) + (counts.project || 0) + (counts.media || 0);
  if (oldestAgeHours != null && oldestAgeHours >= thr.maxAgeHours && depth > 0) {
    return { wake: true, reason: "age" };
  }
  return { wake: false, reason: "quiet" };
}

export async function evaluateWake() {
  const counts = countQueuedByBin();
  const decision = shouldWakeBatch(counts, counts.oldestAgeHours);
  return { ...decision, counts };
}

async function main() {
  const result = await evaluateWake();
  if (!result.wake) {
    console.log("No wake.", result);
    return;
  }
  console.log("Would wake myproblem-batch:", result);
  if (process.env.SPOT_TOKEN) {
    console.log("SPOT_TOKEN set — invoke infra/scripts/spot-wake-batch.sh");
  } else {
    console.log("Set SPOT_TOKEN and run infra/scripts/spot-wake-batch.sh");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
