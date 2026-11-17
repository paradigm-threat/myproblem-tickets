# MyProblem ticket comments rules

Posted on the home topical ticket repo `comments` branch. Batch reads this instead of inventing private exceptions. Keys under a ticket topic are **solution approaches**.

## Filing

- File every post as soon as it appears. Do not wait for disagreement before opening a key.
- Mint a key when a post does not fit keys that already exist. Keys are approaches to solving the problem.
- Never mint a key equal to the page/ticket id.
- Non-arguments (`lol`, join noise) → `other`.
- Questions that name an approach join that key; otherwise follow default question rules.

## Problem / solution resolution

- Tip `resolution` is `unsolved` until the batch sets `solved`. Live path never flips it.
- Humans propose (“fixed”, “that worked”). Batch validates during the same drain as other comment/tip updates.
- **Raiser weight:** the ticket raiser (`raiser_visitor_id` on the tip, or claim holder) has **more weight** than other voices when deciding resolution. If the raiser insists the problem is solved, treat that as strong justification to mark `solved`, unless the claim is clearly contradicted by the dossier or debate.
- If others argue it is solved and that is **reasonably arguable**, that can also justify `solved` even without raiser confirmation.
- If neither holds, keep `unsolved` and summarize what remains to do in positions / tip timeline.
- On `solved`: ask Intake to **drop the live slug** (public `/t/<slug>` dies). Do not publish `ticket_uuid` in public links.

## Privacy

- Redact street addresses, phones, and emails before any KB publish.
- Do not put claim secrets or uuid permalinks into curated public text.
