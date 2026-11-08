/**
 * Region KB git writer — Markdown under MYPROBLEM_KB_ROOT.
 * Searchable facts are not stored; assessments / Limits only (see STORE_POLICY).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_KB = join(__dirname, "../../../myproblem-kb");

export function kbRoot() {
  return process.env.MYPROBLEM_KB_ROOT || DEFAULT_KB;
}

function ensureGitUser(cwd) {
  try {
    execFileSync("git", ["config", "user.email"], { cwd, stdio: "pipe" });
  } catch {
    execFileSync("git", ["config", "user.email", "kb@myproblem.app"], { cwd });
    execFileSync("git", ["config", "user.name", "MyProblem KB"], { cwd });
  }
}

export function kbCommit(message, paths = []) {
  const root = kbRoot();
  if (!existsSync(join(root, ".git"))) {
    throw new Error(`kb_not_a_git_repo:${root}`);
  }
  ensureGitUser(root);
  if (paths.length) {
    execFileSync("git", ["add", "--", ...paths], { cwd: root });
  } else {
    execFileSync("git", ["add", "-A"], { cwd: root });
  }
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (!status.trim()) return { committed: false, root };
  execFileSync("git", ["commit", "-m", message], { cwd: root });
  return { committed: true, root };
}

export function readKbFile(relPath) {
  const fp = join(kbRoot(), relPath);
  if (!existsSync(fp)) return null;
  return readFileSync(fp, "utf8");
}

export function writeKbFile(relPath, body) {
  const fp = join(kbRoot(), relPath);
  mkdirSync(dirname(fp), { recursive: true });
  writeFileSync(fp, body.endsWith("\n") ? body : body + "\n");
  return relPath;
}

/** Link a dossier from a hub page if not already listed. */
export function ensureHubBullet(hubRel, linkRel, label) {
  const hub = readKbFile(hubRel);
  if (!hub) throw new Error(`hub_missing:${hubRel}`);
  const needle = `](${linkRel})`;
  if (hub.includes(needle) || hub.includes(`](./${linkRel.split("/").pop()})`)) {
    return { updated: false };
  }
  const bullet = `- [${label}](${linkRel.split("/").pop()})\n`;
  // Insert before Folder contents or at end of Assessments section
  let next = hub;
  if (hub.includes("*(none yet")) {
    next = hub.replace("*(none yet — filled by Project / E2E research commits)*\n", bullet);
  } else if (hub.includes("## Assessments / dossiers")) {
    next = hub.replace(
      /## Assessments \/ dossiers\n\n/,
      `## Assessments / dossiers\n\n${bullet}`,
    );
  } else {
    next = hub.trimEnd() + `\n\n## Assessments / dossiers\n\n${bullet}\n`;
  }
  writeKbFile(hubRel, next);
  return { updated: true };
}

export function findExistingAssessment(slug) {
  const rel = `georgia/services/home-repair/plumbing/investigations/${slug}-investigation.md`;
  return existsSync(join(kbRoot(), rel)) ? rel : null;
}
