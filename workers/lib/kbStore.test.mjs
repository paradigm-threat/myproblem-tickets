import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("kbStore writes and commits under temp KB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-kb-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@myproblem.app"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  mkdirSync(join(dir, "georgia/services/home-repair/plumbing"), { recursive: true });
  writeFileSync(
    join(dir, "georgia/services/home-repair/plumbing/page.md"),
    "# Plumbing\n\n## Assessments / dossiers\n\n*(none yet — filled by Project / E2E research commits)*\n",
  );
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

  process.env.MYPROBLEM_KB_ROOT = dir;
  const { writeKbFile, ensureHubBullet, kbCommit, readKbFile } = await import("./kbStore.mjs");
  writeKbFile("georgia/services/home-repair/plumbing/investigations/demo-investigation.md", "# Demo\n");
  ensureHubBullet(
    "georgia/services/home-repair/plumbing/page.md",
    "demo.md",
    "Demo assessment",
  );
  const c = kbCommit("test: demo", [
    "georgia/services/home-repair/plumbing/investigations/demo-investigation.md",
    "georgia/services/home-repair/plumbing/page.md",
  ]);
  assert.equal(c.committed, true);
  const hub = readKbFile("georgia/services/home-repair/plumbing/page.md");
  assert.match(hub, /Demo assessment/);
  assert.ok(!hub.includes("*(none yet"));
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MYPROBLEM_KB_ROOT;
});
