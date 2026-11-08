/**
 * Automatic PII conversion — never commit raw street addresses / phones / emails
 * into tip text. Prefer city / safe radius / withheld. See docs/pii-and-privacy.md.
 */

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
/** US-ish street patterns */
const STREET_RE =
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Hwy|Highway|Pkwy|Parkway)\b\.?/gi;
const UNIT_RE = /\b(?:Apt|Apartment|Unit|Suite|Ste)\.?\s*[A-Za-z0-9-]+\b/gi;

/** Very light “Name: …” / “my name is X” — coarsen to withheld */
const MY_NAME_RE = /\b(?:my name is|I am|I'm)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g;

/**
 * @param {string} text
 * @param {{ cityHint?: string }} [opts]
 * @returns {{ text: string, changed: boolean }}
 */
export function convertPii(text, opts = {}) {
  if (!text) return { text: text || "", changed: false };
  let out = text;
  const before = out;
  const city = opts.cityHint || "the local area";

  out = out.replace(EMAIL_RE, "[email withheld]");
  out = out.replace(PHONE_RE, "[phone withheld]");
  out = out.replace(UNIT_RE, "");
  out = out.replace(STREET_RE, `an address in ${city}`);
  out = out.replace(MY_NAME_RE, "my name is [withheld]");
  out = out.replace(/\s{2,}/g, " ").trim();

  return { text: out, changed: out !== before };
}

/** Apply conversion to tip title/description/coach/questions/timeline bodies. */
export function scrubTipPii(tip, opts = {}) {
  if (!tip) return tip;
  if (tip.fields?.title?.value) {
    tip.fields.title.value = convertPii(tip.fields.title.value, opts).text;
  }
  if (tip.fields?.description?.value) {
    tip.fields.description.value = convertPii(tip.fields.description.value, opts).text;
  }
  if (tip.coachLine) tip.coachLine = convertPii(tip.coachLine, opts).text;
  if (Array.isArray(tip.questions)) {
    tip.questions = tip.questions.map((q) => convertPii(q, opts).text);
  }
  if (Array.isArray(tip.timeline)) {
    for (const e of tip.timeline) {
      if (e.body) e.body = convertPii(e.body, opts).text;
    }
  }
  for (const ev of tip.evidence || []) {
    if (ev.text) ev.text = convertPii(ev.text, opts).text;
  }
  return tip;
}
