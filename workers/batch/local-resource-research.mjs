#!/usr/bin/env node
/**
 * Batch: lookup local resources + forums for a tip; write cite-only KB briefs.
 *
 * - Allowed browser only; honest Limits when bots/CAPTCHA block.
 * - Cache short helper briefs + live URLs in georgia (place) or fixit (craft) KB.
 * - No boosting / paid ranking of contractors.
 * - Forums: cite thread URLs; do not scrape full threads into the KB.
 *
 * Usage (when wired):
 *   node workers/batch/local-resource-research.mjs --region georgia --uuid <ticket>
 */

export const LOCAL_RESOURCE_RESEARCH_INSTRUCTIONS = `
When tip has coarse place and a solution route like hire-electrician:
1. Search allowed public pages + forums for local resources.
2. Write a short helper brief into the matching KB (place vs craft).
3. Cite live URLs only — do not freeze-frame pages or dump forum threads.
4. Record honest Limits when a site blocks automation.
5. Never boost or rank shops for pay.
`.trim();

export function planLocalResourceQueries(tip) {
  const region = tip.region || "georgia";
  const title = tip.fields?.title?.value || "";
  const desc = tip.fields?.description?.value || "";
  const q = `${title} ${desc}`.slice(0, 200);
  return {
    region,
    queries: [
      `${region} electrician garage outdoor outlet switched`,
      `${q} site:reddit.com OR site:diy.stackexchange.com`,
      `${region} electrical permit outdoor receptacle GFCI`,
    ],
    kbTargets: {
      place: region === "israel" ? "israel" : "georgia",
      craft: "fixit",
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(LOCAL_RESOURCE_RESEARCH_INSTRUCTIONS);
  console.log(
    JSON.stringify(
      planLocalResourceQueries({
        region: "georgia",
        fields: {
          title: { value: "Garage Ring power" },
          description: { value: "outdoor outlet on light switch" },
        },
      }),
      null,
      2,
    ),
  );
}
