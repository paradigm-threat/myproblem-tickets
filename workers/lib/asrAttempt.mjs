/**
 * Decide what process-jobs should do after an ASR attempt.
 * A failed Groq call must not become a transcript or purge the audio cache.
 */
export function classifyAsrAttempt({ hasKey, httpStatus = 0, text = "", threw = false }) {
  if (!hasKey) return { kind: "dry-run" };
  if (threw) return { kind: "retry", reason: "groq_error" };
  if (httpStatus === 401 || httpStatus === 403) return { kind: "error", reason: "groq_auth" };
  if (httpStatus === 429 || httpStatus >= 500) return { kind: "retry", reason: "groq_unavailable" };
  if (!httpStatus || httpStatus >= 400) return { kind: "error", reason: httpStatus ? `groq_${httpStatus}` : "groq_error" };
  const trimmed = String(text || "").trim();
  if (!trimmed) return { kind: "error", reason: "empty_transcript" };
  return { kind: "ok", text: trimmed };
}
