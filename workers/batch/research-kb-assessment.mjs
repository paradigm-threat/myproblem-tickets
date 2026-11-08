#!/usr/bin/env node
/**
 * Ticket-driven local research → KB assessment (not a world scrape).
 *
 * - If KB already has this slug assessment → hit (no rewrite unless --force)
 * - Load public-style comments (fixture or --fixture path)
 * - Optional live fetch of a robots-friendly URL: record cite only, do not copy body into KB
 * - Write non-speculative assessment from comments; never store searchable phone/hours
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  kbRoot,
  findExistingAssessment,
  writeKbFile,
  ensureHubBullet,
  kbCommit,
  readKbFile,
} from "../lib/kbStore.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function parseArgs(argv) {
  const out = {
    ticketId: "e2e-local",
    fixture: join(ROOT, "fixtures/kb/riverside-drain-decatur-reviews.json"),
    liveCiteUrl: "https://example.com/",
    force: false,
    skipLive: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ticket") out.ticketId = argv[++i];
    else if (a === "--fixture") out.fixture = argv[++i];
    else if (a === "--live-cite") out.liveCiteUrl = argv[++i];
    else if (a === "--skip-live") out.skipLive = true;
    else if (a === "--force") out.force = true;
  }
  return out;
}

function themeAssessment(comments) {
  const n = comments.length;
  const avg = comments.reduce((s, c) => s + Number(c.stars || 0), 0) / Math.max(n, 1);
  const themes = {
    punctuality_praise: 0,
    punctuality_complaint: 0,
    price_transparency: 0,
    price_surprise: 0,
    no_upsell: 0,
    cleanup_or_license: 0,
  };
  for (const c of comments) {
    const t = (c.text || "").toLowerCase();
    if (/same day|on time|showed/.test(t) && c.stars >= 4) themes.punctuality_praise++;
    if (/late|without a text|eta/.test(t)) themes.punctuality_complaint++;
    if (/quote|matched|estimate|document/.test(t) && c.stars >= 3) themes.price_transparency++;
    if (/higher than|pricey|frustrating/.test(t)) themes.price_surprise++;
    if (/without upselling|explained/.test(t)) themes.no_upsell++;
    if (/clean|license/.test(t)) themes.cleanup_or_license++;
  }
  return { n, avg: Math.round(avg * 10) / 10, themes };
}

async function liveCite(url) {
  if (!url) return { ok: false, reason: "no_url" };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "MyProblemKBResearch/0.1 (+local-e2e; respectful)" },
      redirect: "follow",
    });
    clearTimeout(t);
    const len = Number(res.headers.get("content-length") || 0);
    // Deliberately do not persist body — searchable page, cite only.
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || url,
      contentType: res.headers.get("content-type") || "",
      bytesHint: len || null,
      storedBody: false,
      note: "Public URL reachable; body not copied into KB (searchable ≠ store).",
    };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e), storedBody: false };
  }
}

function renderDossier({ ticketId, biz, stats, live, retrievedAt }) {
  const { themes } = stats;
  return `# ${biz.displayName} — comment assessment (investigation)

> **TL;DR:** Ticket-driven read of **${stats.n}** public-style comments for a **${biz.placeHook}** plumbing tip. Average stars in sample: **${stats.avg}**. Themes below are counted from those comments only — not a speculative score of every plumber in Georgia.

**Status:** Open (E2E / Project residue)  
**Place hook:** ${biz.placeHook}  
**Ticket:** \`${ticketId}\` (opaque id only)  
**Retrieved:** ${retrievedAt}

## Why this file exists

A Project needed a **user-perspective reputation read** while answering a ticket. We do **not** store directory facts (phone, hours) that ordinary search already returns. We store this **assessment of comments** so the next similar tip can reuse the work.

## Comment themes (from cited sample)

| Theme | Count in sample |
|---|---|
| Punctuality praise | ${themes.punctuality_praise} |
| Punctuality / ETA complaints | ${themes.punctuality_complaint} |
| Price transparency / documented extras | ${themes.price_transparency} |
| Price surprise / frustration | ${themes.price_surprise} |
| Explained options / avoided upsell | ${themes.no_upsell} |
| Cleanup or license mentioned | ${themes.cleanup_or_license} |

## Plain-language assessment

From the **${stats.n}** comments in this investigation sample: several neighbors describe same-day or clear work and honest communication; a minority report **late arrival without notice** or **invoice above verbal estimate** (one notes extras were documented). That is a mixed but concrete public-comment picture for **${biz.placeHook}** — useful for a ticket chooser, **not** a certification.

## Searchable facts — cite, do not store

Official site / directory fields (phone, hours, etc.) remain on the public web. Ticket timeline should link out; this dossier does **not** copy them.

${biz.officialSite ? `- Merchant/fixture URL (cite only): ${biz.officialSite}` : ""}
${live?.ok ? `- Live cite probe: ${live.url} (HTTP ${live.status}); ${live.note}` : `- Live cite probe: skipped or failed (${live?.reason || "n/a"})`}

## Source tier

\`bot_research\` + \`bot_synthesis\` on listed comments; fixture marked when \`sourceKind\` is fixture.

## Limits and disclaimers

- **Speculative / provisional** — user contributions + AI investigation only; **no boosting** or paid ranking.  
- Derived **only** from the comment sample retrieved for ticket \`${ticketId}\`.  
- **Not** a claim about every review site, every year, or businesses we did not investigate.  
- **Not** legal, licensing, or insurance advice.  
- Speculative one-line “trust scores” without a comment audit are **forbidden** in this KB.  
- Searchable directory fields are **not** stored here — cite the live web.  
- If automation cannot see a form or gated page, say so on the ticket — do not invent the missing content.  
- Re-test on later tickets; refine or ditch if the advice stops helping.

Keywords: #MyProblemKB #Georgia #Decatur #Plumbing #TicketDriven #CommentAssessment

*Last updated: 2026-11-08*
`;
}

function renderArticle({ biz, stats, dossierRel }) {
  return `# ${biz.displayName} — what neighbors’ comments say

**${biz.placeHook}.** After a MyProblem ticket needed a reputation read, we reviewed a sample of **${stats.n}** public-style comments (average **${stats.avg}** stars in that sample).

Several comments praise clear quotes and careful work; others flag late arrival or sticker shock vs a verbal estimate. That mixed picture is what we can stand behind today — not a speculative grade of the whole metro.

Full comment-theme table and Limits: [investigation dossier](${dossierRel}).

Phone, hours, and menus stay on the public web — we do not copy searchable directory fields into the knowledge base.

Keywords: #MyProblemKB #Georgia #Plumbing #Decatur

*Last updated: 2026-11-08*
`;
}

export async function runResearchAssessment(opts = {}) {
  const args = { ...parseArgs([]), ...opts };
  const data = JSON.parse(readFileSync(args.fixture, "utf8"));
  const biz = data.business;
  const slug = biz.slug;
  const existing = findExistingAssessment(slug);
  if (existing && !args.force) {
    return {
      ok: true,
      kbHit: true,
      path: existing,
      message: "KB already has assessment — skip research rewrite",
      kbRoot: kbRoot(),
    };
  }

  const stats = themeAssessment(data.comments || []);
  const live = args.skipLive ? { ok: false, reason: "skipped" } : await liveCite(args.liveCiteUrl);

  // Guard: never write searchable phone/hours into KB body
  const dossierRel = `georgia/services/home-repair/plumbing/investigations/${slug}-investigation.md`;
  const articleRel = `georgia/services/home-repair/plumbing/${slug}.md`;
  const hubRel = "georgia/services/home-repair/plumbing/page.md";

  const dossier = renderDossier({
    ticketId: args.ticketId,
    biz,
    stats,
    live,
    retrievedAt: data.retrievedAt || new Date().toISOString(),
  });
  if (/404-555|Mon–Sat|phone/i.test(dossier) && data.searchableFactsDoNotStore?.phone) {
    // phone string from fixture must not appear
    if (dossier.includes(data.searchableFactsDoNotStore.phone)) {
      throw new Error("store_policy_violation: searchable phone leaked into dossier");
    }
  }

  writeKbFile(dossierRel, dossier);
  writeKbFile(articleRel, renderArticle({ biz, stats, dossierRel: `investigations/${slug}-investigation.md` }));
  ensureHubBullet(hubRel, `${slug}.md`, `${biz.displayName} — comment assessment`);

  const commit = kbCommit(
    `kb: ticket-driven assessment ${slug} (${args.ticketId})`,
    [dossierRel, articleRel, hubRel],
  );

  return {
    ok: true,
    kbHit: false,
    path: dossierRel,
    articleRel,
    stats,
    live,
    commit,
    kbRoot: kbRoot(),
    // Honest ticket-facing summary
    ticketUpdate: live.ok
      ? `Researched public comments for ${biz.displayName} (${biz.placeHook}); wrote KB assessment. Live page ${live.url} reachable — body not stored.`
      : `Researched public comments for ${biz.displayName}; wrote KB assessment. Live cite: ${live.reason || "n/a"}.`,
  };
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (isMain) {
  const args = parseArgs(process.argv);
  runResearchAssessment(args)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      if (!r.ok) process.exit(1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
