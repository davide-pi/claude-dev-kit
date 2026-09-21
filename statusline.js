// Claude Code Status Line — statusline.js (Node.js CJS)
// Requires: Node.js 18+, git in PATH. No external npm dependencies.
//
// Segments:
//   line 1: folder (+ worktree) · git branch + dirty badges · context bar + tokens
//           rate limits + weekly pacing + session cost · worklog badge · vim mode
//   line 2: model · effort level
// ─────────────────────────────────────────────────────────────────────────────


"use strict";
const { execFileSync } = require("node:child_process");
const fs   = require("node:fs");
const os   = require("node:os");
const path = require("node:path");

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

// ── Segment builders ──────────────────────────────────────────────────────────

// Nerd Font glyphs used by the segments below. Written as explicit \u escapes
// rather than pasted literals: these codepoints live in the Private Use Area, so
// a raw glyph is invisible (or a tofu box) in any editor without the font and
// survives copy/paste badly. Comments give each icon's Nerd Font class name.
const ICONS = {
  folder: "\uF07B", // nf-fa-folder      - cwd, outside a linked worktree
  tree:   "\uF1BB", // nf-fa-tree        - worktree, replaces cwd inside one
  branch: "\uF126", // nf-fa-code_branch - git branch
  brain:  "\uEE9C", // nf-fa-brain       - context window
  gauge:  "\uEEB2", // nf-fa-gauge       - rate limits
  bolt:   "\uF0E7", // nf-fa-bolt        - effort level
  vim:    "\uF408", // nf-dev-vim        - vim mode
  clock:  "\uF017", // nf-fa-clock_o     - working days whose hours are not logged
};

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

function segFolder(cwd, worktree) {
  const base = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) || p;
  // Inside a linked worktree the worktree replaces the folder segment outright -
  // tree icon, worktree name and link all point at its root - instead of hanging
  // a "(wd: ...)" suffix off cwd. The main checkout keeps cwd and the folder icon.
  const [icon, path] = worktree ? [ICONS.tree, worktree.root] : [ICONS.folder, cwd];
  return `${C.violet}${BLD}${icon} ${link(pathToFileUri(path), base(path))}${R}`;
}

function segGit(git) {
  if (!git) return "";
  const dirty = git.staged > 0 || git.modified > 0;
  const col   = dirty ? C.yellow : C.lavender;
  let s = `${col}${BLD}${ICONS.branch} ${link(remoteWebUrl(git.remote, git.branch), git.branch)}${R}`;
  const badges = [];
  if (git.staged    > 0) badges.push(`${C.green}+${git.staged}${R}`);
  if (git.modified  > 0) badges.push(`${C.yellow}~${git.modified}${R}`);
  if (git.untracked > 0) badges.push(`${C.gray}?${git.untracked}${R}`);
  if (badges.length) s += " " + badges.join(" ");
  return s;
}

// Token counts are abbreviated to keep the segment short. The M step matters:
// a 1M-token window would otherwise render as the unreadable "1000k".
function abbrevTokens(n) {
  n = Number(n);
  if (!Number.isFinite(n) || n < 0) return null;
  const scale = (v, suffix) =>
    (Number.isInteger(v) ? String(v) : v.toFixed(1)) + suffix;
  if (n >= 1e6)  return scale(n / 1e6, "M");
  if (n >= 1000) return scale(n / 1000, "k");
  return String(Math.round(n));
}

// The percentage alone doesn't say how much room is left in absolute terms, and
// the window size varies by model: 62% of 200k and 62% of 1M are different
// decisions. The token pair is rendered only when the payload carries both.
function segContext(ctx) {
  const pct    = ctx?.used_percentage ?? 0;
  const BAR_W  = 8;
  const filled = Math.min(BAR_W, Math.round(pct / 100 * BAR_W));
  const empty  = BAR_W - filled;
  const col    = pct < 40 ? C.green : pct < 60 ? C.yellow : pct < 80 ? C.orange : C.red;
  const pctStr = `${Math.round(pct)}%`.padStart(4);
  const bar    = `${col}${"█".repeat(filled)}${DIM}${"░".repeat(empty)}${R}`;
  const used   = abbrevTokens(ctx?.total_input_tokens);
  const total  = abbrevTokens(ctx?.context_window_size);
  const tok    = (used && total) ? ` ${DIM}(${used}/${total})${R}` : "";
  return `${DIM}[${R} ${ICONS.brain} ${bar} ${col}${pctStr}${R}${tok} ${DIM}]${R}`;
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

// Weekly pacing, on the SAME basis as the value it annotates: everything in this
// segment is headroom left, so the target is how much SHOULD still be left at
// this point in the window, and the delta is signed accordingly — positive means
// ahead of pace (green), negative means burning too fast (red). Unlike a
// whole-day target that jumps 14 points at midnight, the elapsed fraction is
// continuous, so the delta moves only when consumption does. Both integers are
// taken from what is actually printed, so the three numbers can never disagree
// by a rounding step.
function weeklyPace(remainingPct, epoch, windowSec) {
  if (!epoch) return "";
  const remainSec = (epoch * 1000 - Date.now()) / 1000;
  if (remainSec <= 0 || remainSec > windowSec) return "";
  const target = Math.round(remainSec / windowSec * 100);
  const delta  = remainingPct - target;
  const col    = delta >= 0 ? C.green : C.red;
  const sign   = delta > 0 ? "+" : "";
  return ` ${DIM}(t:${target}%${R} ${col}${sign}${delta}%${R}${DIM})${R}`;
}

// Session cost. Precision scales down so a short session isn't flattened to
// "$0.00"; an untouched session (exactly 0) renders nothing rather than "$0.0000".
function fmtCost(cost) {
  const n = Number(cost);
  if (!Number.isFinite(n) || n <= 0) return "";
  const s = n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2);
  return `${C.yellow}$${s}${R}`;
}

// ── Rate-limit cache ────────────────────────────────────────────────────────
// Claude Code populates `rate_limits` only after the first request of the
// session registers usage; at cold start the field is absent and the segment
// would be empty. To keep the 5h/7d readout visible immediately, we persist the
// last-known snapshot on every render and fall back to it when live data is
// missing, so the rate-limit readout is there from the first frame.
const RL_CACHE = path.join(os.homedir(), ".claude", ".statusline-rate-limits.json");

function saveRateLimitCache(rl) {
  try {
    const slim = {};
    if (rl.five_hour != null) slim.five_hour = { used_percentage: rl.five_hour.used_percentage, resets_at: rl.five_hour.resets_at };
    if (rl.seven_day != null) slim.seven_day = { used_percentage: rl.seven_day.used_percentage, resets_at: rl.seven_day.resets_at };
    fs.writeFileSync(RL_CACHE, JSON.stringify(slim));
  } catch { /* best-effort: cache write failures are non-fatal */ }
}

// Reconcile a cached snapshot against the current time. resets_at is absolute,
// so each window is still meaningful across restarts:
//   • reset still in the future -> same window; keep cached used% + countdown
//   • reset already elapsed      -> window rolled over; true state is fresh
//                                   headroom (0% used) with reset time unknown
function reconcileCached() {
  let cached;
  try { cached = JSON.parse(fs.readFileSync(RL_CACHE, "utf8")); } catch { return null; }
  if (!cached || (cached.five_hour == null && cached.seven_day == null)) return null;
  const now = Date.now();
  const fix = (w) => (w == null) ? null
    : (w.resets_at && w.resets_at * 1000 <= now) ? { used_percentage: 0, resets_at: null } : w;
  const out = {};
  if (cached.five_hour != null) out.five_hour = fix(cached.five_hour);
  if (cached.seven_day != null) out.seven_day = fix(cached.seven_day);
  return out;
}

// `stale` marks values sourced from the cache (last-known, not live) with a dim
// "~" so they aren't mistaken for a fresh reading.
function segRateLimits(rl, stale, cost) {
  const mark = stale ? `${DIM}~${R}` : "";
  const parts = [];
  if (rl) {
    // The countdown already says which window a value belongs to, so the "5h"/"7d"
    // label is redundant — except when resets_at is missing (a cached entry whose
    // window has rolled over), where the label is the only thing telling them apart.
    const win = (w, windowSec, label, pace) => {
      const { used_percentage: u, resets_at: r } = w;
      const col = rateColor(u, r, windowSec);
      const cd  = fmtCountdown(r);
      const lbl = cd ? "" : `${DIM}${label}${R} `;
      const rem = Math.round(100 - u);
      // Pacing is a weekly notion: over five hours the target moves too fast to act on.
      const pc  = pace ? weeklyPace(rem, r, windowSec) : "";
      parts.push(`${lbl}${mark}${col}${rem}%${R}${cd}${pc}`);
    };
    if (rl.five_hour != null) win(rl.five_hour, 18000,  "5h", false);
    if (rl.seven_day != null) win(rl.seven_day, 604800, "7d", true);
  }
  const cost$ = fmtCost(cost);
  if (cost$) parts.push(cost$);
  if (!parts.length) return "";
  return `${DIM}[${R} ${ICONS.gauge} ${parts.join(` ${DIM}|${R} `)} ${DIM}]${R}`;
}

// Fallback for model and effort when the payload doesn't carry them (cold start,
// or a truncated payload): the configured default from settings.json. It is a
// guess, not a reading — settings.json stores an alias ("opus[1m]") rather than a
// display name, and knows nothing of a mid-session /model switch — so a value
// sourced from it is marked with the same dim "~" as a stale rate limit.
const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
let settingsCache;
function readSettings() {
  if (settingsCache === undefined) {
    try { settingsCache = JSON.parse(fs.readFileSync(SETTINGS, "utf8")); }
    catch { settingsCache = null; }
  }
  return settingsCache;
}

function segModel(name, stale) {
  if (!name) return "";
  const short = name
    .replace("Claude ", "").replace(" Sonnet", " Son")
    .replace(" Haiku",  " Hku").replace(" Opus", " Opx");
  const mark = stale ? `${DIM}~${R}` : "";
  return `${DIM}[${R} ${mark}${C.sky}${short}${R} ${DIM}]${R}`;
}

// Effort level: low | medium | high | xhigh | max
function segEffort(level, stale) {
  if (!level) return "";
  const col =
    level === "max"    ? C.pink   :
    level === "xhigh"  ? C.orange :
    level === "high"   ? C.yellow :
    level === "medium" ? C.green  : C.gray;
  const mark = stale ? `${DIM}~${R}` : "";
  return `${DIM}[${R} ${mark}${col}${ICONS.bolt} ${level.toUpperCase()}${R} ${DIM}]${R}`;
}

// Working days that had real work and never reached a work item. The snapshot is
// written by hooks/worklog-pending.js at session start; this only renders it, so
// the statusline never pays for the scan. Stale means silent rather than wrong:
// a snapshot from another day, or from before /worklog last wrote its audit, is
// dropped — which is also how the badge clears itself the moment hours are logged.
const WL_CACHE = path.join(os.homedir(), ".claude", ".worklog-pending.json");
const WL_AUDIT = path.join(os.homedir(), ".claude", "worklog", "pushed.json");

function segWorklog() {
  try {
    const snap = JSON.parse(fs.readFileSync(WL_CACHE, "utf8"));
    const today = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const iso = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
    if (snap.day !== iso) return "";
    let auditMtime = 0;
    try { auditMtime = fs.statSync(WL_AUDIT).mtimeMs; } catch { auditMtime = 0; }
    if (snap.auditMtime !== auditMtime) return "";
    const n = (snap.pending || []).length;
    if (!n) return "";
    // Red once the oldest is beyond the week: past that the transcripts start
    // aging out and the day can no longer be reconstructed.
    const oldest = snap.pending[0].date;
    const stale  = (Date.now() - Date.parse(`${oldest}T12:00:00`)) > 7 * 864e5;
    const col    = stale ? C.red : C.yellow;
    return `${DIM}[${R} ${col}${ICONS.clock} ${n}d${R} ${DIM}]${R}`;
  } catch { return ""; }
}

// Vim mode indicator (only visible when vim mode is active)
function segVim(vim) {
  if (!vim) return "";
  const col =
    vim.mode === "INSERT"      ? C.green  :
    vim.mode.startsWith("VIS") ? C.orange : C.lavender;
  return `${DIM}[${R} ${col}${ICONS.vim} ${vim.mode}${R} ${DIM}]${R}`;
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

  // Live rate-limit data if present (and cache it); otherwise fall back to the
  // last-known snapshot so the 5h/7d readout stays visible from cold start.
  let rl = data.rate_limits, rlStale = false;
  if (rl && (rl.five_hour != null || rl.seven_day != null)) {
    saveRateLimitCache(rl);
  } else {
    rl = reconcileCached();
    rlStale = rl != null;
  }

  // Model and effort fall back to the configured default when the payload is
  // silent; `stale` then marks them as a guess rather than a reading.
  let modelName   = data.model?.display_name || "";
  let effortLevel = data.effort?.level || "";
  let modelStale  = false, effortStale = false;
  if (!modelName || !effortLevel) {
    const s = readSettings();
    if (!modelName   && s?.model)       { modelName   = s.model;       modelStale  = true; }
    if (!effortLevel && s?.effortLevel) { effortLevel = s.effortLevel; effortStale = true; }
  }

  const sepStr = `  ${C.sep}·${R}  `;
  const W      = termWidth() - 1;

  // Right-align a line to the terminal edge, truncating when it doesn't fit
  // (reserving 1 column for the ellipsis appended by truncateAnsi).
  const fit = (line) => {
    const width = visibleWidth(line);
    return width > W ? truncateAnsi(line, W - 1) : " ".repeat(W - width) + line;
  };

  // Line 1 is the workspace and the budgets; line 2 is what the session runs as.
  const line1 = [
    segFolder(cwd, worktreeInfo(cwd)),
    segGit(gitInfo(cwd)),
    segContext(data.context_window),
    segRateLimits(rl, rlStale, data.cost?.total_cost_usd),
    segWorklog(),
    segVim(data.vim),
  ].filter(Boolean).join(sepStr);

  const line2 = [
    segModel(modelName, modelStale),
    segEffort(effortLevel, effortStale),
  ].filter(Boolean).join(sepStr);

  process.stdout.write([line1, line2].filter(Boolean).map(fit).join("\n") + "\n");
});
process.stdin.on("error", () => { process.stdout.write("\n"); });
