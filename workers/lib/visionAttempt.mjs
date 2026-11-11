/**
 * Rapid still analysis: one unique frame plus the spoken transcript.
 * A failed call must not become a caption or purge the still.
 */

export function classifyVisionAttempt({ hasKey, httpStatus = 0, text = "", threw = false }) {
  if (!hasKey) return { kind: "dry-run" };
  if (threw) return { kind: "retry", reason: "groq_error" };
  if (httpStatus === 401 || httpStatus === 403) return { kind: "error", reason: "groq_auth" };
  if (httpStatus === 429 || httpStatus >= 500) return { kind: "retry", reason: "groq_unavailable" };
  if (!httpStatus || httpStatus >= 400) return { kind: "error", reason: httpStatus ? `groq_${httpStatus}` : "groq_error" };
  const trimmed = plainCaption(text);
  if (!trimmed) return { kind: "error", reason: "empty_caption" };
  return { kind: "ok", text: trimmed };
}

export function plainCaption(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function chatContent(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

export function visionPrompt({ transcript = "" } = {}) {
  const said = String(transcript || "").replace(/\s+/g, " ").trim();
  const speech = said
    ? `They said: "${said.slice(0, 600)}"`
    : "They have not spoken yet.";
  return [
    "Reply with JSON only: {\"caption\":\"...\",\"question\":\"\"}.",
    "caption is one or two sentences for a support ticket.",
    speech,
    "This image is one unique frame they kept from the camera, not a video file.",
    "Describe only the visible problem that fits what they said.",
    "If the frame does not show that problem, say what is visible and set question to one short request for the missing shot.",
    "If the frame shows the problem, question must be an empty string.",
    "Do not give repair advice. Do not invent part numbers, names, or addresses.",
    "For electrical, gas, fire, medical, structural, chemical, or fall hazards, do not give steps. Say what is visible only.",
  ].join(" ");
}

export function parseVisionReply(text) {
  const trimmed = plainCaption(text);
  if (!trimmed) return { caption: "", question: "" };
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed.caption === "string") {
        return {
          caption: plainCaption(parsed.caption),
          question: cleanQuestion(parsed.question),
        };
      }
    } catch {
      /* prose caption */
    }
  }
  return { caption: trimmed, question: "" };
}

export function cleanQuestion(question) {
  const q = plainCaption(question || "");
  if (!q || /^(none|n\/a|no|no question)\.?$/i.test(q)) return "";
  return q.slice(0, 180);
}

/** Keep evidence, jobs, and timeline saved by another request while this job was in flight. */
export function absorbNewerTip(tip, latest) {
  if (!tip || !latest) return tip;
  tip.evidence = tip.evidence || [];
  tip.jobs = tip.jobs || [];
  tip.timeline = tip.timeline || [];
  const evIds = new Set(tip.evidence.map((e) => e.id));
  for (const e of latest.evidence || []) {
    if (e?.id && !evIds.has(e.id)) tip.evidence.push(e);
  }
  const jobIds = new Set(tip.jobs.map((j) => j.id));
  for (const j of latest.jobs || []) {
    if (j?.id && !jobIds.has(j.id)) tip.jobs.push(j);
  }
  const tlIds = new Set(tip.timeline.map((e) => e.id));
  for (const e of latest.timeline || []) {
    if (e?.id && !tlIds.has(e.id)) tip.timeline.push(e);
  }
  const questions = Array.isArray(tip.questions) ? tip.questions : [];
  for (const q of latest.questions || []) {
    if (q && !questions.includes(q)) questions.push(q);
  }
  tip.questions = questions.slice(-3);
  return tip;
}

export function mergeQuestions(existing, question) {
  const q = cleanQuestion(question);
  const list = (Array.isArray(existing) ? existing : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (!q) return list.slice(-3);
  if (list.some((item) => item.toLowerCase() === q.toLowerCase())) return list.slice(-3);
  return [...list, q].slice(-3);
}

/** Spoken words stay first. Each unique frame adds what the camera showed. */
export function composeTicketDescription({ transcript = "", vision = "" } = {}) {
  const said = String(transcript || "").replace(/\s+/g, " ").trim();
  const frames = (Array.isArray(vision) ? vision : vision ? [vision] : [])
    .map((v) => String(v || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const seen =
    frames.length > 1 ? frames.map((v, i) => `Frame ${i + 1}: ${v}`).join(" ") : frames[0] || "";
  let out = "";
  if (said && seen) out = `${said}\n\nFrom the still: ${seen}`;
  else out = seen || said;
  return out.slice(0, 800);
}

/**
 * A still that arrives while the person is still talking should wait for the
 * transcript. With no audio on the ticket, wait only holdMs, then describe the frame alone.
 */
export function shouldDeferVision(tip, now = Date.now(), holdMs = 90_000) {
  if (latestEvidenceText(tip, "transcript")) return false;
  const jobs = Array.isArray(tip?.jobs) ? tip.jobs : [];
  const evidence = Array.isArray(tip?.evidence) ? tip.evidence : [];
  const asrOpen = jobs.some((j) => j.bin === "asr" && (j.state === "queued" || j.state === "leased"));
  const audioPending = evidence.some((e) => e.kind === "audio" && !e.processed && e.uri);
  if (asrOpen || audioPending) return true;
  if (jobs.some((j) => j.bin === "asr" && j.state === "error")) return false;
  const stamps = [];
  for (const e of evidence) {
    if (e.kind === "still" && !e.processed && e.atMs) stamps.push(e.atMs);
  }
  for (const j of jobs) {
    if (j.bin === "vision" && j.state === "queued" && j.updatedAtMs) stamps.push(j.updatedAtMs);
  }
  const started = stamps.length ? Math.min(...stamps) : now;
  return now - started < holdMs;
}

export function evidenceTexts(tip, role) {
  const list = Array.isArray(tip?.evidence) ? tip.evidence : [];
  const out = [];
  for (const e of list) {
    const text = String(e?.text || "").trim();
    if (!text || e.model === "dry-run" || text.startsWith("[dry-run]")) continue;
    if (role === "transcript" && e.kind === "transcript") out.push(text);
    if (role === "vision" && e.role === "vision") out.push(text);
  }
  return out;
}

export function latestEvidenceText(tip, role) {
  const all = evidenceTexts(tip, role);
  return all.length ? all[all.length - 1] : "";
}
