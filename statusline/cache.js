// Claude Code status line: the files it persists under the config directory (see ../statusline.js).
"use strict";
const fs   = require("node:fs");
const os   = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

// Per-session context snapshot for hooks/lib/context-size.js (done-claim), which runs on
// Stop and has no access to this payload. One file per session so
// parallel sessions never read each other's numbers; `used_percentage` is null
// before the first response and right after /compact, and is written as null.
// Resolved like the hooks resolve it (CLAUDE_CONFIG_DIR first), so both sides
// agree on the path when the configuration directory is relocated.
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

// With `refreshInterval` the line renders every couple of seconds, far more often than a branch or a
// dirty count moves: the git results are kept per cwd in a small file (the process is new on every render,
// so memory is no use). The status (branch, dirty counts, remote) for several renders; whether cwd is a
// linked worktree, which almost never changes, for minutes. Best-effort: any failure just runs `fn`.
const GIT_CACHE_MS = 30_000;
const WORKTREE_CACHE_MS = 10 * 60_000;
function cachedByCwd(name, cwd, ttlMs, fn) {
  const file = path.join(CONFIG_DIR, ".cache", `${name}-${crypto.createHash("sha1").update(String(cwd)).digest("hex").slice(0, 16)}.json`);
  try {
    const hit = JSON.parse(fs.readFileSync(file, "utf8"));
    if (hit && Date.now() - hit.at < ttlMs) return hit.value ?? null;
  } catch { /* no cache yet */ }
  const value = fn();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), value }));
  } catch { /* best-effort */ }
  return value;
}

function usedTokens(ctx) {
  if (!Number.isFinite(ctx?.used_percentage) || !Number.isFinite(ctx?.context_window_size)) return null;
  return Math.round(ctx.used_percentage / 100 * ctx.context_window_size);
}

// The statusline renders far more often than these numbers move, so the file is written only when a value
// changed. Unchanged values still refresh it once an hour: the reader distrusts a snapshot older than six.
const SNAPSHOT_REFRESH_MS = 60 * 60 * 1000;

function saveContextSnapshot(sessionId, ctx, cache) {
  if (typeof sessionId !== "string" || !/^[\w-]{1,128}$/.test(sessionId)) return;
  try {
    const dir = path.join(CONFIG_DIR, ".cache");
    const file = path.join(dir, `context-${sessionId}.json`);
    const values = {
      used_percentage: Number.isFinite(ctx?.used_percentage) ? ctx.used_percentage : null,
      // Absolute size, for lib/context-size.js's token threshold: the percentage alone means little on a 1M window.
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
  } catch { /* best-effort: the reader simply sees no snapshot */ }
}

// The cache folder collects per-session and per-folder files for good. Once an hour (guarded by the mtime of a
// marker file: one stat per render otherwise) the ones this script owns are pruned by age; any other file is
// left alone. The current session's files are never removed.
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const PRUNE_RULES = [
  { re: /^(?:git|worktree)-[0-9a-f]{16}\.json$/, maxAgeMs: 60 * 60 * 1000 },  // valid for 30 s / 10 min only
  { re: /^context-[\w-]+\.json$/, maxAgeMs: 6 * 60 * 60 * 1000 },              // lib/context-size.js distrusts it past 6 h
  { re: /^cockpit-(?!data-)[\w-]+\.json$/, maxAgeMs: 3 * 24 * 60 * 60 * 1000 }, // a live idle session rewrites it only on change, an ended one is closed by the mod
];
// The cockpit's session data (history, PRs, note, context samples) lives as long as the session can be resumed: no age rule,
// it goes when `projects/*/<session>.jsonl` is gone.
const SESSION_DATA_RE = /^cockpit-data-([\w-]+)\.json$/;

/** The ids of the sessions that still have a transcript (one readdir of `projects/` and of each project folder); undefined when that cannot be told. */
function transcriptIds() {
  try {
    const root = path.join(CONFIG_DIR, "projects");
    const ids = new Set();
    for (const project of fs.readdirSync(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      for (const name of fs.readdirSync(path.join(root, project.name))) {
        if (name.endsWith(".jsonl")) ids.add(name.slice(0, -".jsonl".length));
      }
    }
    return ids;
  } catch { return undefined; }  // a folder that cannot be listed hides transcripts: delete nothing
}

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
      ? [`context-${currentSessionId}.json`, `cockpit-${currentSessionId}.json`, `cockpit-data-${currentSessionId}.json`] : []);
    let transcripts;  // read at the first data file, once
    for (const name of fs.readdirSync(dir)) {
      const data = SESSION_DATA_RE.exec(name);
      if (data) {
        if (keep.has(name)) continue;
        transcripts ??= transcriptIds() ?? null;
        try { if (transcripts && !transcripts.has(data[1])) fs.unlinkSync(path.join(dir, name)); } catch { /* next hour */ }
        continue;
      }
      const rule = PRUNE_RULES.find((r) => r.re.test(name));
      if (!rule || keep.has(name)) continue;
      try {
        const file = path.join(dir, name);
        if (now - fs.statSync(file).mtimeMs > rule.maxAgeMs) fs.unlinkSync(file);
      } catch { /* gone already, or locked: next hour */ }
    }
  } catch { /* best-effort */ }
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

module.exports = {
  CONFIG_DIR, GIT_CACHE_MS, WORKTREE_CACHE_MS, cachedByCwd, saveContextSnapshot, pruneCache,
  saveRateLimitCache, reconcileCached, readSettings, readCockpit,
};
