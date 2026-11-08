import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const FIXTURE = join(ROOT, "fixtures/kb/riverside-drain-decatur-reviews.json");

function seedKb(dir) {
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@myproblem.app"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  mkdirSync(join(dir, "georgia/services/home-repair/plumbing/investigations"), { recursive: true });
  writeFileSync(
    join(dir, "georgia/services/home-repair/plumbing/page.md"),
    "# Plumbing (Georgia)\n\n## Assessments / dossiers\n\n*(none yet — filled by Project / E2E research commits)*\n\n---\n",
  );
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
}

test("research writes assessment and skips searchable phone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-kb-e2e-"));
  seedKb(dir);
  process.env.MYPROBLEM_KB_ROOT = dir;

  const { runResearchAssessment } = await import("./research-kb-assessment.mjs");
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const phone = fixture.searchableFactsDoNotStore.phone;

  const r1 = await runResearchAssessment({
    ticketId: "ticket-e2e-1",
    fixture: FIXTURE,
    skipLive: true,
    force: false,
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.kbHit, false);
  assert.equal(r1.stats.n, 5);

  const dossier = readFileSync(join(dir, r1.path), "utf8");
  assert.match(dossier, /comment assessment/i);
  assert.match(dossier, /Decatur/);
  assert.ok(!dossier.includes(phone), "must not store searchable phone");
  assert.ok(!dossier.includes(fixture.searchableFactsDoNotStore.hours), "must not store hours");

  const r2 = await runResearchAssessment({
    ticketId: "ticket-e2e-2",
    fixture: FIXTURE,
    skipLive: true,
  });
  assert.equal(r2.kbHit, true, "second run should hit KB");

  rmSync(dir, { recursive: true, force: true });
  delete process.env.MYPROBLEM_KB_ROOT;
});
