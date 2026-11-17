/**
 * SI public slug suggestion once ticket context is determined.
 * Topic + originality; no PII / fine location in the slug.
 */

const BLOCKED = new Set([
  "help",
  "ticket",
  "problem",
  "fixit",
  "electrical",
  "repair",
  "diy",
  "myproblem",
  "test",
  "demo",
]);

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "from",
  "this",
  "that",
  "want",
  "would",
  "like",
  "my",
  "i",
  "is",
  "are",
  "be",
  "when",
  "which",
  "into",
  "so",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
}

function kebab(parts, maxTokens = 5) {
  const out = [];
  for (const p of parts) {
    if (out.includes(p)) continue;
    out.push(p);
    if (out.length >= maxTokens) break;
  }
  return out.join("-");
}

function isBlocked(slug) {
  if (!slug || slug.length < 4) return true;
  if (BLOCKED.has(slug)) return true;
  const parts = slug.split("-");
  if (parts.length === 1 && BLOCKED.has(parts[0])) return true;
  return false;
}

/**
 * @param {{ title?: string, description?: string, existingSlugs?: string[], topicHint?: string }} input
 */
export function suggestPublicSlug(input = {}) {
  const existing = new Set([...(input.existingSlugs || [])].map((s) => String(s).toLowerCase()));
  const tokens = [...tokenize(input.title), ...tokenize(input.description)];
  const titleFirst = tokenize(input.title).slice(0, 4);
  const hint = tokenize(input.topicHint);

  const candidates = [];
  const push = (parts) => {
    const s = kebab(parts);
    if (!s || isBlocked(s)) return;
    if (!candidates.includes(s)) candidates.push(s);
  };

  push([...titleFirst]);
  push([...hint, ...titleFirst]);
  push(tokens.slice(0, 5));

  const alternatives = [];
  let suggested = "";
  for (const c of candidates) {
    let slug = c;
    let n = 2;
    while (existing.has(slug) && n < 20) {
      slug = `${c}-${n}`;
      n += 1;
    }
    if (existing.has(slug) || isBlocked(slug)) continue;
    if (!suggested) suggested = slug;
    else if (alternatives.length < 4 && slug !== suggested) alternatives.push(slug);
  }

  if (!suggested) suggested = `problem-${Date.now().toString(36).slice(-5)}`;

  return {
    suggested,
    alternatives,
    rationale:
      "Topic-shaped kebab slug after context is clear; originality vs existing public slugs; no PII.",
  };
}
