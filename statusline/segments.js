// Claude Code status line: the segment builders (see ../statusline.js).
"use strict";
const fs   = require("node:fs");
const path = require("node:path");
const { R, DIM, BLD, C, link } = require("./ansi");
const { CONFIG_DIR } = require("./cache");

// ── Segment builders ──────────────────────────────────────────────────────────

// Nerd Font glyphs used by the segments below. Written as explicit \u escapes
// rather than pasted literals: these codepoints live in the Private Use Area, so
// a raw glyph is invisible (or a tofu box) in any editor without the font and
// survives copy/paste badly. Comments give each icon's Nerd Font class name.
const ICONS = {
  folder: "\u{F024B}", // nf-md-folder          - cwd, or the worktree root inside a linked worktree
  branch: "\u{F062C}", // nf-md-source_branch  - git branch
  brain:  "\u{F09D1}", // nf-md-brain    - prompt-cache hit (Material Design set: fa-brain is missing from the font)
  vim:    "\uF408", // nf-dev-vim        - vim mode
  clock:  "\uF017", // nf-fa-clock_o     - working days whose hours are not logged
  snow:   "\uF2DC", // nf-fa-snowflake_o - prompt cache expired
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

// Effort level -> battery icon and color, as the cockpit pane draws it. These sit in the supplementary
// Private Use Area (Material Design set), hence \u{...}. A level this table does not name gets no icon.
const EFFORT = {
  low:    { icon: "\u{F12A1}", col: C.gray   },
  medium: { icon: "\u{F12A2}", col: C.green  },
  high:   { icon: "\u{F12A3}", col: C.yellow },
  xhigh:  { icon: "\u{F12A6}", col: C.orange },
  max:    { icon: "\u{F0083}", col: C.red    },
};

function segFolder(cwd, worktree) {
  const base = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) || p;
  // Inside a linked worktree the worktree replaces the folder segment outright -
  // worktree name and link both point at its root - instead of hanging a
  // "(wd: ...)" suffix off cwd. The main checkout keeps cwd. One icon for both.
  const path = worktree ? worktree.root : cwd;
  return `${C.violet}${BLD}${ICONS.folder} ${link(pathToFileUri(path), base(path))}${R}`;
}

function segGit(git) {
  if (!git) return "";
  const dirty = git.staged > 0 || git.modified > 0;
  const col   = dirty ? C.yellow : C.lavender;
  let s = `${col}${BLD}${ICONS.branch} ${link(remoteWebUrl(git.remote, git.branch), git.branch)}${R}`;
  const badges = [];
  if (git.staged    > 0) badges.push(`${C.green}+${git.staged}${R}`);
  if (git.modified  > 0) badges.push(`${C.yellow}~${git.modified}${R}`);
  if (git.untracked > 0) badges.push(`${C.dim}?${git.untracked}${R}`);
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
  if (n >= 1000) return scale(n / 1000, "K");
  return String(Math.round(n));
}

// Prompt-cache hit of the last main turn, from the usage the payload already carries (no file read):
// cache_read / (cache_read + cache_creation + input), coloured like the cockpit (80 / 50). Nothing when
// the usage is absent (before the first call, after /compact), a field is not a number, or the total is 0.
function segCacheHit(usage) {
  if (!usage || typeof usage !== "object") return "";
  const part = (v) => (v == null ? 0 : v);
  const read = part(usage.cache_read_input_tokens);
  const total = read + part(usage.cache_creation_input_tokens) + part(usage.input_tokens);
  if (![read, total].every((n) => Number.isFinite(n) && n >= 0) || total === 0) return "";
  const pct = Math.round(read / total * 100);
  const col = pct >= 80 ? C.green : pct >= 50 ? C.amber : C.red;
  return ` ${col}${ICONS.brain} ${pct}%${R}`;
}

// The percentage alone doesn't say how much room is left in absolute terms, and
// the window size varies by model: 62% of 200k and 62% of 1M are different
// decisions. The token pair is rendered only when the payload carries both.
function segContext(ctx) {
  const pct    = ctx?.used_percentage ?? 0;
  const BAR_W  = 8;
  const filled = Math.min(BAR_W, Math.round(pct / 100 * BAR_W));
  const empty  = BAR_W - filled;
  const col    = pct < 40 ? C.green : pct < 80 ? C.yellow : C.red;
  const pctStr = `${Math.round(pct)}%`.padStart(4);
  const bar    = `${col}${"▰".repeat(filled)}${C.empty}${"▱".repeat(empty)}${R}`;
  const used   = abbrevTokens(ctx?.total_input_tokens);
  const total  = abbrevTokens(ctx?.context_window_size);
  const tok    = (used && total) ? ` ${DIM}(${used}/${total})${R}` : "";
  return `${bar} ${col}${pctStr}${R}${tok}${segCacheHit(ctx?.current_usage)}`;
}

// The cached prefix has expired: the next request re-writes the whole context
// at cache-write price. Shown only once caching has been observed at all, so a
// provider that never reports cache tokens does not wear a permanent badge.
function segCacheCold(cache) {
  if (!cache?.caching_observed) return "";
  const expired = cache.warm === false ||
    (Number.isFinite(cache.expires_at) && cache.expires_at * 1000 <= Date.now());
  if (!expired) return "";
  const tokens = abbrevTokens(cache.recache_tokens_if_cold);
  return `${C.sky}${ICONS.snow} cache cold${tokens ? ` ${tokens}` : ""}${R}`;
}

function fmtCountdown(epoch) {
  if (!epoch) return "";
  const diff = epoch * 1000 - Date.now();
  if (diff <= 0) return "";
  const totalMin = Math.floor(diff / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  // "↻" is drawn wider than its one counted cell by some terminals: always followed by an explicit space.
  if (d > 0) return ` ${DIM}↻${R} ${d}d${h}h`;
  if (h > 0) return ` ${DIM}↻${R} ${h}h${m}m`;
  return ` ${DIM}↻${R} ${m}m`;
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
// taken from what is actually printed, so the numbers can never disagree by a
// rounding step. Printed as the cockpit pane does: `(+5%)` / `(−5%)`, true minus.
function weeklyPace(remainingPct, epoch, windowSec) {
  if (!epoch) return "";
  const remainSec = (epoch * 1000 - Date.now()) / 1000;
  if (remainSec <= 0 || remainSec > windowSec) return "";
  const target = Math.round(remainSec / windowSec * 100);
  const delta  = remainingPct - target;
  const col    = delta >= 0 ? C.green : C.red;
  const sign   = delta < 0 ? "\u2212" : "+";
  return ` ${col}(${sign}${Math.abs(delta)}%)${R}`;
}

// Session cost, always shown as the cockpit pane does (`$0.00` for an untouched or absent cost).
// Precision scales down so a short session isn't flattened to "$0.00".
function fmtCost(cost) {
  const n = Number(cost);
  if (!Number.isFinite(n) || n <= 0) return `${C.yellow}$0.00${R}`;
  const s = n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2);
  return `${C.yellow}$${s}${R}`;
}

// The cockpit mod's last-turn cost, appended to the session cost. Omitted when null, 0 or under a cent.
function fmtTurnCost(usd) {
  const n = Number(usd);
  if (usd == null || !Number.isFinite(n) || n < 0.005) return "";
  return ` ${DIM}+$${n.toFixed(2)}${R}`;
}

// One segment per rate-limit window, labelled `5h` / `7d` (dim). `stale` marks values sourced from the cache (last-known, not live) with a dim "~" so they
// aren't mistaken for a fresh reading.
function segRateWindows(rl, stale) {
  if (!rl) return [];
  const mark = stale ? `${DIM}~${R}` : "";
  const win = (w, windowSec, label, pace) => {
    const { used_percentage: u, resets_at: r } = w;
    const col = rateColor(u, r, windowSec);
    const rem = Math.round(100 - u);
    // Pacing is a weekly notion: over five hours the target moves too fast to act on.
    const pc  = pace ? weeklyPace(rem, r, windowSec) : "";
    return `${DIM}${label}${R} ${mark}${col}${rem}%${R}${fmtCountdown(r)}${pc}`;
  };
  const segs = [];
  if (rl.five_hour != null) segs.push(win(rl.five_hour, 18000,  "5h", false));
  if (rl.seven_day != null) segs.push(win(rl.seven_day, 604800, "7d", true));
  return segs;
}

// Session cost plus, when the cockpit mod reports one, the last turn's.
function segCost(cost, turnCost) {
  return fmtCost(cost) + fmtTurnCost(turnCost);
}

function segModel(name, stale) {
  if (!name) return "";
  // A trailing parenthetical (`Opus 5.5 (1M context)`) is dropped: the context segment already says it.
  const short = name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace("Claude ", "");
  const mark = stale ? `${DIM}~${R}` : "";
  return `${mark}${C.blue}${short}${R}`;
}

// Effort level: low | medium | high | xhigh | max
function segEffort(level, stale) {
  if (!level) return "";
  const { icon, col } = EFFORT[level] ?? { icon: "", col: C.gray };
  const mark = stale ? `${DIM}~${R}` : "";
  return `${mark}${col}${icon ? `${icon} ` : ""}${level.toUpperCase()}${R}`;
}

// Agents running (blue) and agents on another model than asked (yellow); nothing when both are zero.
// `open:true` counts only while the mod keeps refreshing `at` (its slow tier does, every 30 s): a leftover from a
// reloaded mod or a close it never heard of must not hide the line forever. 90 s is three beats.
const COCKPIT_FRESH_MS = 90 * 1000;
function cockpitIsOpen(cockpit) {
  return cockpit?.open === true && Number.isFinite(cockpit.at) && Date.now() - cockpit.at < COCKPIT_FRESH_MS;
}

function segAgents(cockpit) {
  const count = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
  const running = count(cockpit?.agents?.running);
  const warned  = count(cockpit?.agents?.modelWarnings);
  const parts = [];
  if (running) parts.push(`${C.blue}◐${running}${R}`);
  if (warned)  parts.push(`${C.yellow}⚠${warned}${R}`);
  if (!parts.length) return "";
  return parts.join(" ");
}

// Tasks of the main thread, from the cockpit mod: `☐ done/total`, green once all are done; nothing without tasks.
function segTasks(cockpit) {
  const done = cockpit?.tasks?.done, total = cockpit?.tasks?.total;
  if (!Number.isInteger(done) || !Number.isInteger(total) || total <= 0 || done < 0) return "";
  return `${DIM}☐${R} ${done === total ? C.green : ""}${done}/${total}${R}`;
}

// Working days that had real work and never reached a work item. The snapshot is
// written by hooks/worklog-pending.js at session start; this only renders it, so
// the statusline never pays for the scan. Stale means silent rather than wrong:
// a snapshot from another day, or from before /worklog last wrote its audit, is
// dropped — which is also how the badge clears itself the moment hours are logged.
const WL_CACHE = path.join(CONFIG_DIR, ".worklog-pending.json");
const WL_AUDIT = path.join(CONFIG_DIR, "worklog", "pushed.json");

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
    return `${col}${ICONS.clock} ${n}d${R}`;
  } catch { return ""; }
}

// Vim mode indicator (only visible when vim mode is active)
function segVim(vim) {
  if (!vim) return "";
  const col =
    vim.mode === "INSERT"      ? C.green  :
    vim.mode.startsWith("VIS") ? C.orange : C.lavender;
  return `${col}${ICONS.vim} ${vim.mode}${R}`;
}

module.exports = {
  segFolder, segGit, segContext, segCacheCold, segRateWindows, segCost, segModel, segEffort,
  segAgents, segTasks, segWorklog, segVim, cockpitIsOpen,
};
