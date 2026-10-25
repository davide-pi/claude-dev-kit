// Claude Code Status Line — statusline.js (Node.js CJS)
// Requires: Node.js 18+, git in PATH. No external npm dependencies.
//
// Segments (no brackets, joined by a dim middle dot, as the cockpit pane reads):
//   line 1: model + effort · folder (+ worktree) · git branch + dirty badges · context bar + tokens
//           5h window · 7d window + weekly pacing · session cost · agents badge · tasks done/total
//   line 2 (only when any): worklog badge · cache-cold badge · vim mode
// Optional cockpit state file (mods/cockpit writes ~/.claude/.cache/cockpit-<session>.json): when present,
// line 1 gains the last turn's cost, the agents badge and the tasks badge, and the whole output is silent
// while the cockpit pane is open (the pane carries the same data). Without the mod the line is unchanged.
// ─────────────────────────────────────────────────────────────────────────────


"use strict";
const { execFileSync } = require("node:child_process");
const fs   = require("node:fs");
const os   = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const esc = (code) => `\x1b[${code}m`;
const R   = esc("0");   // reset
const DIM = esc("2");   // dim
const BLD = esc("1");   // bold

// OSC 8 hyperlink: wraps LABEL so it becomes clickable (Ctrl/Cmd-click) in
// terminals that support it; falls back to plain LABEL when URL is missing. The
// escape sequences carry zero display width — stripAnsi/truncateAnsi skip them.
const link = (url, label) => (url ? `\x1b]8;;${url}\x07${label}\x1b]8;;\x07` : label);

// The cockpit mod's palette (hooks/format.ts COLORS), so the status line and the pane read as one.
const C = {
  gray:     esc("38;2;140;140;140"),
  dim:      esc("38;2;154;160;170"),
  yellow:   esc("38;2;255;207;138"),
  amber:    esc("38;2;232;163;90"),
  green:    esc("38;2;126;198;153"),
  red:      esc("38;2;240;122;111"),
  orange:   esc("38;2;255;158;94"),
  blue:     esc("38;2;127;180;255"),
  violet:   esc("38;2;125;91;166"),
  lavender: esc("38;2;160;130;200"),
  sky:      esc("38;2;100;180;220"),
  sep:      esc("38;2;74;79;89"),
  empty:    esc("38;2;51;54;60"),
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
  const remote = run("remote", "get-url", "origin");

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

// With `refreshInterval` the line renders every couple of seconds, far more often than a branch or a
// dirty count moves: the git results are kept per cwd for a few seconds in a small file (the process is
// new on every render, so memory is no use). Best-effort: any failure just runs `fn`.
const GIT_CACHE_MS = 5000;
function cachedByCwd(name, cwd, fn) {
  const file = path.join(CONFIG_DIR, ".cache", `${name}-${crypto.createHash("sha1").update(String(cwd)).digest("hex").slice(0, 16)}.json`);
  try {
    const hit = JSON.parse(fs.readFileSync(file, "utf8"));
    if (hit && Date.now() - hit.at < GIT_CACHE_MS) return hit.value ?? null;
  } catch { /* no cache yet */ }
  const value = fn();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), value }));
  } catch { /* best-effort */ }
  return value;
}

// ── Segment builders ──────────────────────────────────────────────────────────

// Nerd Font glyphs used by the segments below. Written as explicit \u escapes
// rather than pasted literals: these codepoints live in the Private Use Area, so
// a raw glyph is invisible (or a tofu box) in any editor without the font and
// survives copy/paste badly. Comments give each icon's Nerd Font class name.
const ICONS = {
  folder: "\u{F024B}", // nf-md-folder          - cwd, outside a linked worktree
  tree:   "\u{F0253}", // nf-md-folder_multiple - worktree, replaces cwd inside one
  branch: "\u{F062C}", // nf-md-source_branch  - git branch
  brain:  "\u{F09D1}", // nf-md-brain    - context window (Material Design set: fa-brain is missing from the font)
  gauge:  "\u{F029A}", // nf-md-gauge    - rate limits (fa-gauge is missing from the font)
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
  return `${ICONS.brain} ${bar} ${col}${pctStr}${R}${tok}`;
}

// Per-session context snapshot for hooks/context-nudge.js, which runs on
// UserPromptSubmit and has no access to this payload. One file per session so
// parallel sessions never read each other's numbers; `used_percentage` is null
// before the first response and right after /compact, and is written as null.
// Resolved like the hooks resolve it (CLAUDE_CONFIG_DIR first), so both sides
// agree on the path when the configuration directory is relocated.
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

function usedTokens(ctx) {
  if (!Number.isFinite(ctx?.used_percentage) || !Number.isFinite(ctx?.context_window_size)) return null;
  return Math.round(ctx.used_percentage / 100 * ctx.context_window_size);
}

// The statusline renders far more often than these numbers move, so the file is written only when a value
// changed. Unchanged values still refresh it once an hour: the nudge distrusts a snapshot older than six.
const SNAPSHOT_REFRESH_MS = 60 * 60 * 1000;

function saveContextSnapshot(sessionId, ctx, cache) {
  if (typeof sessionId !== "string" || !/^[\w-]{1,128}$/.test(sessionId)) return;
  try {
    const dir = path.join(CONFIG_DIR, ".cache");
    const file = path.join(dir, `context-${sessionId}.json`);
    const values = {
      used_percentage: Number.isFinite(ctx?.used_percentage) ? ctx.used_percentage : null,
      // Absolute size, for the nudge's token bands: the percentage alone means little on a 1M window.
      // Derived from the percentage, not from `total_input_tokens`, which is cumulative over the session.
      used_tokens: usedTokens(ctx),
      window: Number.isFinite(ctx?.context_window_size) ? ctx.context_window_size : null,
      warm: typeof cache?.warm === "boolean" ? cache.warm : null,
      caching_observed: cache?.caching_observed === true,
    };
    let previous = null;
    try { previous = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first render */ }
    if (previous && Date.now() - previous.at < SNAPSHOT_REFRESH_MS
        && Object.keys(values).every((k) => previous[k] === values[k])) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...values, at: Date.now() }));
  } catch { /* best-effort: the nudge simply stays silent */ }
}

// The cache folder collects per-session and per-folder files for good. Once an hour (guarded by the mtime of a
// marker file: one stat per render otherwise) the ones this script owns are pruned by age; any other file is
// left alone. The current session's files are never removed.
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const PRUNE_RULES = [
  { re: /^(?:git|worktree)-[0-9a-f]{16}\.json$/, maxAgeMs: 60 * 60 * 1000 },  // valid for 5 s only
  { re: /^context-[\w-]+\.json$/, maxAgeMs: 6 * 60 * 60 * 1000 },              // the nudge distrusts it past 6 h
  { re: /^cockpit-[\w-]+\.json$/, maxAgeMs: 3 * 24 * 60 * 60 * 1000 },       // as hooks/context-nudge.js; a live idle session rewrites it only on change, an ended one is closed by the mod
];

function pruneCache(currentSessionId) {
  try {
    const dir = path.join(CONFIG_DIR, ".cache");
    const marker = path.join(dir, ".statusline-prune");
    const now = Date.now();
    let age = Infinity;  // never pruned
    try { age = now - fs.statSync(marker).mtimeMs; } catch { /* no marker yet */ }
    if (age >= 0 && age < PRUNE_EVERY_MS) return;  // a marker from the future (clock moved back) does not block
    // The folder exists by now (the snapshot and the git caches create it); if the marker cannot be written, skip.
    try { fs.writeFileSync(marker, ""); } catch { return; }
    const keep = new Set(typeof currentSessionId === "string"
      ? [`context-${currentSessionId}.json`, `cockpit-${currentSessionId}.json`] : []);
    for (const name of fs.readdirSync(dir)) {
      const rule = PRUNE_RULES.find((r) => r.re.test(name));
      if (!rule || keep.has(name)) continue;
      try {
        const file = path.join(dir, name);
        if (now - fs.statSync(file).mtimeMs > rule.maxAgeMs) fs.unlinkSync(file);
      } catch { /* gone already, or locked: next hour */ }
    }
  } catch { /* best-effort */ }
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

// ── Rate-limit cache ────────────────────────────────────────────────────────
// Claude Code populates `rate_limits` only after the first request of the
// session registers usage; at cold start the field is absent and the segment
// would be empty. To keep the 5h/7d readout visible immediately, we persist the
// last-known snapshot on every render and fall back to it when live data is
// missing, so the rate-limit readout is there from the first frame.
const RL_CACHE = path.join(CONFIG_DIR, ".statusline-rate-limits.json");

function saveRateLimitCache(rl) {
  try {
    const slim = {};
    if (rl.five_hour != null) slim.five_hour = { used_percentage: rl.five_hour.used_percentage, resets_at: rl.five_hour.resets_at };
    if (rl.seven_day != null) slim.seven_day = { used_percentage: rl.seven_day.used_percentage, resets_at: rl.seven_day.resets_at };
    // Rewritten only when a value changed: the line renders every couple of seconds.
    const next = JSON.stringify(slim);
    let current = null;
    try { current = fs.readFileSync(RL_CACHE, "utf8"); } catch { /* first render */ }
    if (current !== next) fs.writeFileSync(RL_CACHE, next);
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

// One segment per rate-limit window, labelled `5h` / `7d` (dim) and, for the first present one, led by the
// gauge icon. `stale` marks values sourced from the cache (last-known, not live) with a dim "~" so they
// aren't mistaken for a fresh reading.
function segRateWindows(rl, stale) {
  if (!rl) return [];
  const mark = stale ? `${DIM}~${R}` : "";
  const win = (w, windowSec, label, pace, icon) => {
    const { used_percentage: u, resets_at: r } = w;
    const col = rateColor(u, r, windowSec);
    const rem = Math.round(100 - u);
    // Pacing is a weekly notion: over five hours the target moves too fast to act on.
    const pc  = pace ? weeklyPace(rem, r, windowSec) : "";
    return `${icon ? `${icon} ` : ""}${DIM}${label}${R} ${mark}${col}${rem}%${R}${fmtCountdown(r)}${pc}`;
  };
  const segs = [];
  if (rl.five_hour != null) segs.push(win(rl.five_hour, 18000,  "5h", false, ICONS.gauge));
  if (rl.seven_day != null) segs.push(win(rl.seven_day, 604800, "7d", true,  segs.length ? "" : ICONS.gauge));
  return segs;
}

// Session cost plus, when the cockpit mod reports one, the last turn's.
function segCost(cost, turnCost) {
  return fmtCost(cost) + fmtTurnCost(turnCost);
}

// Fallback for model and effort when the payload doesn't carry them (cold start,
// or a truncated payload): the configured default from settings.json. It is a
// guess, not a reading — settings.json stores an alias ("opus[1m]") rather than a
// display name, and knows nothing of a mid-session /model switch — so a value
// sourced from it is marked with the same dim "~" as a stale rate limit.
const SETTINGS = path.join(CONFIG_DIR, "settings.json");
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
  // A trailing parenthetical (`Opus 5.5 (1M context)`) is dropped: the context segment already says it.
  const short = name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace("Claude ", "").replace(" Sonnet", " Son")
    .replace(" Haiku",  " Hku").replace(" Opus", " Opx");
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

// State the cockpit mod writes for this session (see mods/cockpit): whether its pane is open, the last
// turn's cost, the agent counts. Missing or unreadable means no mod: the line is then exactly what it is
// without it. The id is validated as saveContextSnapshot does, since it ends up in a path.
function readCockpit(sessionId) {
  if (typeof sessionId !== "string" || !/^[\w-]{1,128}$/.test(sessionId)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, ".cache", `cockpit-${sessionId}.json`), "utf8"));
    return state && typeof state === "object" ? state : null;
  } catch { return null; }
}

// Agents running (blue) and agents on another model than asked (yellow); nothing when both are zero.
// `open:true` counts only while the mod keeps refreshing `at` (its tick does, every 15 s): a leftover from a
// reloaded mod or a close it never heard of must not hide the line forever.
const COCKPIT_FRESH_MS = 45 * 1000;
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

// ── Main ──────────────────────────────────────────────────────────────────────
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let data;
  try { data = JSON.parse(raw); } catch { process.stdout.write("\n"); return; }
  if (!data || typeof data !== "object") { process.stdout.write("\n"); return; }

  const cwd = data.cwd || data.workspace?.current_dir || process.cwd();
  saveContextSnapshot(data.session_id, data.context_window, data.prompt_cache);
  pruneCache(data.session_id);

  // The cockpit pane carries all of this while it is open: the line stays empty.
  const cockpit = readCockpit(data.session_id);
  // A zero-width space, not an empty line: an empty output may leave the previous line on screen.
  if (cockpitIsOpen(cockpit)) { process.stdout.write("\u200B\n"); return; }

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

  // Line 1: what the session runs as, the workspace and the budgets. Line 2: badges, printed only when any.
  const line1 = [
    [segModel(modelName, modelStale), segEffort(effortLevel, effortStale)].filter(Boolean).join(" "),
    segFolder(cwd, cachedByCwd("worktree", cwd, () => worktreeInfo(cwd))),
    segGit(cachedByCwd("git", cwd, () => gitInfo(cwd))),
    segContext(data.context_window),
    ...segRateWindows(rl, rlStale),
    segCost(data.cost?.total_cost_usd, cockpit?.lastTurnUsd),
    segAgents(cockpit),
    segTasks(cockpit),
  ].filter(Boolean).join(sepStr);

  const line2 = [
    segWorklog(),
    segCacheCold(data.prompt_cache),
    segVim(data.vim),
  ].filter(Boolean).join(sepStr);

  process.stdout.write([line1, line2].filter(Boolean).map(fit).join("\n") + "\n");
});
process.stdin.on("error", () => { process.stdout.write("\n"); });
