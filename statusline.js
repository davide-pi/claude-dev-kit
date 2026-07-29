// Claude Code Status Line — statusline.js (Node.js CJS)
// Requires: Node.js 18+, git in PATH. No external npm dependencies.
//
// Segments:
//   folder · git branch + dirty badges · context bar · rate limits (5h/7d)
//   model · effort level · PR badge · vim mode
// ─────────────────────────────────────────────────────────────────────────────


"use strict";
const { execFileSync } = require("node:child_process");

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const esc = (code) => `\x1b[${code}m`;
const R   = esc("0");   // reset
const DIM = esc("2");   // dim
const BLD = esc("1");   // bold

// OSC 8 hyperlink: wraps LABEL so it becomes clickable (Ctrl/Cmd-click) in
// terminals that support it; falls back to plain LABEL when URL is missing. The
// escape sequences carry zero display width — stripAnsi/truncateAnsi skip them.
const link = (url, label) => (url ? `\x1b]8;;${url}\x07${label}\x1b]8;;\x07` : label);

const C = {
  gray:     esc("38;2;140;140;140"),
  yellow:   esc("33"),
  green:    esc("32"),
  red:      esc("31"),
  orange:   esc("38;5;208"),
  violet:   esc("38;2;125;91;166"),
  lavender: esc("38;2;160;130;200"),
  sky:      esc("38;2;100;180;220"),
  sep:      esc("38;2;70;70;70"),
  teal:     esc("38;2;80;200;180"),
  pink:     esc("38;2;220;100;160"),
};

const stripAnsi = (s) =>
  s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;]*m/g, "");

// ── Terminal width ────────────────────────────────────────────────────────────
function termWidth() {
  try {
    return process.stdout.columns ||
           (process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) : 0) ||
           80;
  } catch { return 80; }
}

// ── Display width (ANSI-aware, wide-char-aware) ────────────────────────────────
// stripAnsi(...).length counts code points, not on-screen columns. CJK, emoji and
// many full-width glyphs occupy 2 columns; account for them so padding and
// truncation stay aligned.
function cpWidth(cp) {
  if (
    (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2E80 && cp <= 0x303E) ||
    (cp >= 0x3040 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7A3) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE19) ||
    (cp >= 0xFE30 && cp <= 0xFE4F) ||
    (cp >= 0xFF00 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x1F300 && cp <= 0x1FAFF)
  ) return 2;
  return 1;
}

function visibleWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += cpWidth(ch.codePointAt(0));
  return w;
}

// Truncate an ANSI-colored string to `maxW` display columns, preserving escape
// sequences (they don't count toward width) and appending an ellipsis + reset so
// no color leaks past the cut.
function truncateAnsi(s, maxW) {
  const sgrRe = /^\x1b\[[0-9;]*m/;
  const oscRe = /^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/;
  let out = "", w = 0, i = 0;
  while (i < s.length) {
    const sgr = s.slice(i).match(sgrRe);
    if (sgr) { out += sgr[0]; i += sgr[0].length; continue; }
    const osc = s.slice(i).match(oscRe);
    if (osc) { out += osc[0]; i += osc[0].length; continue; }
    const cp    = s.codePointAt(i);
    const chStr = String.fromCodePoint(cp);
    const cw    = cpWidth(cp);
    if (w + cw > maxW) break;
    out += chStr;
    w   += cw;
    i   += chStr.length;
  }
  // Close any hyperlink left open by the cut (harmless no-op otherwise), then reset.
  return out + "\x1b]8;;\x07" + "…" + R;
}

// ── Git info (fast, skip optional locks) ──────────────────────────────────────
function gitInfo(cwd) {
  function run(...args) {
    try {
      return execFileSync("git", ["-C", cwd, "--no-optional-locks", ...args], {
        encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 2000,
      }).trim();
    } catch { return null; }
  }

  const branch = run("rev-parse", "--abbrev-ref", "HEAD");
  if (!branch) return null;
  const remote = run("remote", "get-url", "origin");

  let staged = 0, modified = 0, untracked = 0;
  const out = run("status", "--porcelain");
  if (out) {
    for (const line of out.split("\n")) {
      if (line.length < 2) continue;
      const x = line[0], y = line[1];
      if (x !== " " && x !== "?") staged++;
      if (y !== " " && y !== "?") modified++;
      if (line.startsWith("??")) untracked++;
    }
  }
  return { branch, remote, staged, modified, untracked };
}

// ── Segment builders ──────────────────────────────────────────────────────────

// Nerd Font glyphs (requires CaskaydiaCove NF or compatible):
//    = nf-fa-folder
//    = nf-fa-code_branch
//    = nf-fa-brain
//    = nf-fa-gauge
//    = nf-fa-bolt
//    = nf-dev-vim
//    = nf-oct-git_pull_request (approximation)

// Convert a Windows/POSIX path to a file:// URI. Ctrl/Cmd-clicking it in a
// supporting terminal opens the folder (Explorer on Windows). Each segment is
// percent-encoded; the drive letter's colon is restored afterwards.
function pathToFileUri(p) {
  if (!p) return null;
  let u = p.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
  u = u.replace(/^([A-Za-z])%3A/i, "$1:");
  if (!u.startsWith("/")) u = "/" + u;
  return "file://" + u;
}

// Derive a browsable web URL (pointing at BRANCH) from a git "origin" remote.
// Handles Azure DevOps (dev.azure.com and legacy *.visualstudio.com) plus
// GitHub/GitLab/Bitbucket over HTTPS or SSH. Returns null when unrecognized.
function remoteWebUrl(remote, branch) {
  if (!remote) return null;
  const r  = remote.trim().replace(/\.git$/, "");
  const br     = encodeURIComponent(branch || "");                       // query-param form (slash -> %2F, for Azure DevOps ?version=GB...)
  const brPath = (branch || "").split("/").map(encodeURIComponent).join("/"); // path form (keeps literal slashes, for /tree/...)
  let m;
  // Azure DevOps over SSH: git@ssh.dev.azure.com:v3/org/project/repo
  if ((m = r.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)$/)))
    return `https://dev.azure.com/${m[1]}/${m[2]}/_git/${encodeURIComponent(m[3])}?version=GB${br}`;
  // Azure DevOps over HTTPS: https://[org@]dev.azure.com/org/project/_git/repo
  if ((m = r.match(/^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/(.+)$/)))
    return `https://dev.azure.com/${m[1]}/${m[2]}/_git/${encodeURIComponent(m[3])}?version=GB${br}`;
  // Legacy Azure DevOps: https://org.visualstudio.com/<path>/_git/repo
  if ((m = r.match(/^https?:\/\/([^.]+)\.visualstudio\.com\/(.+)\/_git\/(.+)$/)))
    return `https://${m[1]}.visualstudio.com/${m[2]}/_git/${encodeURIComponent(m[3])}?version=GB${br}`;
  // GitHub/GitLab/Bitbucket over SSH: git@host:owner/repo
  if ((m = r.match(/^git@([^:]+):(.+)$/)))
    return `https://${m[1]}/${m[2]}/tree/${brPath}`;
  // ssh://git@host/owner/repo
  if ((m = r.match(/^ssh:\/\/[^@]+@([^/]+)\/(.+)$/)))
    return `https://${m[1]}/${m[2]}/tree/${brPath}`;
  // GitHub/GitLab/Bitbucket over HTTPS
  if ((m = r.match(/^https?:\/\/(?:[^@/]+@)?(github\.com|gitlab\.com|bitbucket\.org)\/(.+)$/)))
    return `https://${m[1]}/${m[2]}/tree/${brPath}`;
  // Fallback: any plain https remote (no branch deep-link)
  if (/^https?:\/\//.test(r)) return r;
  return null;
}

function segFolder(cwd) {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  const name  = parts.at(-1) || cwd;
  return `${C.violet}${BLD} ${link(pathToFileUri(cwd), name)}${R}`;
}

function segGit(git) {
  if (!git) return "";
  const dirty = git.staged > 0 || git.modified > 0;
  const col   = dirty ? C.yellow : C.lavender;
  let s = `${col}${BLD} ${link(remoteWebUrl(git.remote, git.branch), git.branch)}${R}`;
  const badges = [];
  if (git.staged    > 0) badges.push(`${C.green}+${git.staged}${R}`);
  if (git.modified  > 0) badges.push(`${C.yellow}~${git.modified}${R}`);
  if (git.untracked > 0) badges.push(`${C.gray}?${git.untracked}${R}`);
  if (badges.length) s += " " + badges.join(" ");
  return s;
}

function segContext(usedPct) {
  const pct    = usedPct ?? 0;
  const BAR_W  = 8;
  const filled = Math.min(BAR_W, Math.round(pct / 100 * BAR_W));
  const empty  = BAR_W - filled;
  const col    = pct < 40 ? C.green : pct < 60 ? C.yellow : pct < 80 ? C.orange : C.red;
  const pctStr = `${Math.round(pct)}%`.padStart(4);
  const bar    = `${col}${"█".repeat(filled)}${DIM}${"░".repeat(empty)}${R}`;
  return `${DIM}[${R}  ${bar} ${col}${pctStr}${R} ${DIM}]${R}`;
}

function fmtCountdown(epoch) {
  if (!epoch) return "";
  const diff = epoch * 1000 - Date.now();
  if (diff <= 0) return "";
  const totalMin = Math.floor(diff / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return ` ${DIM}·${d}d${h}h${R}`;
  if (h > 0) return ` ${DIM}·${h}h${m}m${R}`;
  return ` ${DIM}·${m}m${R}`;
}

// Color by projected end-of-window usage (constant-burn assumption).
// Projected <= 80 -> green (headroom), <= 100 -> yellow, > 100 -> red (will hit limit).
function rateColor(used, epoch, windowSec) {
  const rem = 100 - used;
  const abs = rem > 60 ? C.green : rem > 30 ? C.yellow : C.red;
  if (!epoch || !windowSec) return abs;
  const remainSec   = (epoch * 1000 - Date.now()) / 1000;
  if (remainSec <= 0) return abs;
  const elapsedFrac = 1 - remainSec / windowSec;
  if (elapsedFrac < 0.1) return abs;          // too early in window
  const projected = used / elapsedFrac;
  return projected <= 80 ? C.green : projected <= 100 ? C.yellow : C.red;
}

function segRateLimits(rl) {
  if (!rl) return "";
  const parts = [];
  if (rl.five_hour != null) {
    const { used_percentage: u, resets_at: r } = rl.five_hour;
    const col = rateColor(u, r, 18000);
    parts.push(`${DIM}5h${R} ${col}${Math.round(100 - u)}%${R}${fmtCountdown(r)}`);
  }
  if (rl.seven_day != null) {
    const { used_percentage: u, resets_at: r } = rl.seven_day;
    const col = rateColor(u, r, 604800);
    parts.push(`${DIM}7d${R} ${col}${Math.round(100 - u)}%${R}${fmtCountdown(r)}`);
  }
  if (!parts.length) return "";
  return `${DIM}[${R}  ${parts.join(` ${DIM}|${R} `)} ${DIM}]${R}`;
}

function segModel(name) {
  if (!name) return "";
  const short = name
    .replace("Claude ", "").replace(" Sonnet", " Son")
    .replace(" Haiku",  " Hku").replace(" Opus", " Opx");
  return `${DIM}[${R} ${C.sky}${short}${R} ${DIM}]${R}`;
}

// Effort level: low | medium | high | xhigh | max
function segEffort(effort) {
  if (!effort) return "";
  const col =
    effort.level === "max"    ? C.pink   :
    effort.level === "xhigh"  ? C.orange :
    effort.level === "high"   ? C.yellow :
    effort.level === "medium" ? C.green  : C.gray;
  return `${DIM}[${R} ${col} ${effort.level.toUpperCase()}${R} ${DIM}]${R}`;
}

// Open PR badge with review state
function segPR(pr) {
  if (!pr) return "";
  const col =
    pr.review_state === "approved"          ? C.green :
    pr.review_state === "changes_requested" ? C.red   :
    pr.review_state === "draft"             ? C.gray  : C.teal;
  const label = pr.review_state
    ? `#${pr.number} ${pr.review_state.replace(/_/g, " ")}`
    : `#${pr.number}`;
  return `${DIM}[${R} ${col} ${link(pr.url, label)}${R} ${DIM}]${R}`;
}

// Vim mode indicator (only visible when vim mode is active)
function segVim(vim) {
  if (!vim) return "";
  const col =
    vim.mode === "INSERT"      ? C.green  :
    vim.mode.startsWith("VIS") ? C.orange : C.lavender;
  return `${DIM}[${R} ${col} ${vim.mode}${R} ${DIM}]${R}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let data;
  try { data = JSON.parse(raw); } catch { process.stdout.write("\n"); return; }
  if (!data || typeof data !== "object") { process.stdout.write("\n"); return; }

  const cwd = data.cwd || data.workspace?.current_dir || process.cwd();

  const parts = [
    segFolder(cwd),
    segGit(gitInfo(cwd)),
    segContext(data.context_window?.used_percentage),
    segRateLimits(data.rate_limits),
    segModel(data.model?.display_name),
    segEffort(data.effort),
    segPR(data.pr),
    segVim(data.vim),
  ].filter(Boolean);

  const sepStr = `  ${C.sep}·${R}  `;
  const line   = parts.join(sepStr);
  const W      = termWidth() - 1;
  const width  = visibleWidth(line);

  if (width > W) {
    // Reserve 1 column for the ellipsis appended by truncateAnsi.
    process.stdout.write(truncateAnsi(line, W - 1) + "\n");
  } else {
    process.stdout.write(" ".repeat(W - width) + line + "\n");
  }
});
process.stdin.on("error", () => { process.stdout.write("\n"); });
