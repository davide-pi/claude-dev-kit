// Claude Code status line: git status and linked-worktree detection (see ../statusline.js).
"use strict";
const { execFileSync } = require("node:child_process");
const path = require("node:path");

// ── Git info (fast, skip optional locks) ──────────────────────────────────────
function gitInfo(cwd) {
  function run(...args) {
    try {
      return execFileSync("git", ["-C", cwd, "--no-optional-locks", ...args], {
        encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 2000,
      }).trim();
    } catch { return null; }
  }

  // One `status -b` call gives the branch (its `##` header) and the dirty counts: a separate
  // `rev-parse --abbrev-ref HEAD` used to cost a second process on every render.
  const out = run("status", "--porcelain", "-b");
  if (!out) return null;
  const lines = out.split("\n");
  // `main...origin/main [ahead 1]` · `main` · `HEAD (no branch)` · `No commits yet on main`
  const header = lines[0].startsWith("## ") ? lines.shift().slice(3) : "";
  const branch = header.replace(/^(?:No commits yet|Initial commit) on /, "")
    .split("...")[0].replace(/ \(no branch\)$/, "").trim();
  if (!branch) return null;
  // The remote is read off `.git/config`: no second process.
  let remote = null;
  try {
    // Required here, not at the top: a missing hooks/ costs the link, never the whole line.
    const { findGitDir, remoteUrl } = require(path.join(__dirname, "..", "hooks", "lib", "git-dir"));
    const repo = findGitDir(cwd);
    remote = repo ? remoteUrl(repo.gitDir) : null;
  } catch { /* no remote link */ }

  let staged = 0, modified = 0, untracked = 0;
  for (const line of lines) {
    if (line.length < 2) continue;
    const x = line[0], y = line[1];
    if (x !== " " && x !== "?") staged++;
    if (y !== " " && y !== "?") modified++;
    if (line.startsWith("??")) untracked++;
  }
  return { branch, remote, staged, modified, untracked };
}

// Linked-worktree detection. Inside a linked worktree --git-dir points at
// .git/worktrees/<name> while --git-common-dir points at the main checkout's
// .git; in the main checkout the two are identical (both ".git"). A single
// rev-parse returns both plus the worktree root, so this costs one git call.
function worktreeInfo(cwd) {
  try {
    const out = execFileSync("git", ["-C", cwd, "--no-optional-locks", "rev-parse",
      "--git-dir", "--git-common-dir", "--show-toplevel"], {
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 2000,
    }).trim().split("\n").map((l) => l.trim());
    if (out.length < 3) return null;
    const [gitDir, commonDir, root] = out;
    const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    return norm(gitDir) === norm(commonDir) ? null : { root };
  } catch { return null; }
}

module.exports = { gitInfo, worktreeInfo };
