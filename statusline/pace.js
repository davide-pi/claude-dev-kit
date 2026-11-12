// Usage pace, shared file <config dir>/.usage-pace.json (schema and contract: docs/usage-pace.md).
// recordPace() runs in the status line (also with the cockpit pane open); readers are the pace hook and scripts.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BANDS = [98, 96, 92, 85, 70];
const SAMPLE_GAP_MS = 60_000;
const REWRITE_MS = 60_000; // an unchanged reading refreshes updatedAt at most this often (readers call 10 min stale)
const SAMPLE_KEEP = 60;
const BURN_LOOKBACK_MS = 30 * 60_000;
const BURN_MIN_SAMPLES = 3;
const BURN_MIN_SPAN_MS = 5 * 60_000;
const WINDOWS = [["five_hour", "samples5h"], ["seven_day", "samples7d"]];

// Read at call time: tests and relocated config directories set it per process or per call.
const paceFile = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), ".usage-pace.json");

let lastGood = null; // { file, value }: what a torn read falls back to

function readPace() {
  const file = paceFile();
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value && typeof value === "object" && value.five_hour && value.seven_day) {
      lastGood = { file, value };
      return value;
    }
  } catch { /* torn, missing or unreadable: the last good value below */ }
  return lastGood && lastGood.file === file ? lastGood.value : null;
}

const finite = (n) => typeof n === "number" && Number.isFinite(n);

function recordPace(rl, now, writer) {
  if (!rl || typeof rl !== "object") return;
  const file = paceFile();
  // The status line is a new process at each render: a torn file (the cockpit writes in place) has no last good value
  // here, and rewriting it from scratch would drop the samples and the cockpit's fields. Skip this render instead.
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {
    if (e.code !== "ENOENT") return;
  }
  if (prev !== null && (typeof prev !== "object" || Array.isArray(prev))) return;
  const before = JSON.stringify(prev || {});
  const next = { ...(prev || {}), v: 1, updatedAt: now, writer };

  for (const [key, samplesKey] of WINDOWS) {
    const w = rl[key];
    const old = next[key];
    let samples = Array.isArray(next[samplesKey]) ? next[samplesKey] : [];
    if (w && finite(w.used_percentage) && finite(w.resets_at)) {
      const resetsAt = Math.round(w.resets_at * 1000), pct = w.used_percentage;
      // A newer reset starts a new window; within one window the percentage only grows.
      const newer = !old || resetsAt > old.resetsAt;
      if (newer || (resetsAt === old.resetsAt && pct >= old.pct)) {
        if (newer) samples = [];
        next[key] = { pct, resetsAt };
        if (!samples.length || now - samples[samples.length - 1].t >= SAMPLE_GAP_MS) samples.push({ t: now, pct });
        samples = samples.slice(-SAMPLE_KEEP);
      }
    }
    next[key] = next[key] || { pct: 0, resetsAt: 0 };
    next[samplesKey] = samples;
  }

  // Nothing new and written less than a minute ago: no write (the line renders every couple of seconds).
  if (prev && finite(prev.updatedAt) && now - prev.updatedAt < REWRITE_MS
    && JSON.stringify({ ...next, updatedAt: prev.updatedAt, writer: prev.writer }) === before) return;

  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(next));
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}

const bandOf = (pct) => BANDS.find((b) => pct >= b) || 0;

function windowView(w, samples, now) {
  if (!w || !finite(w.pct) || !finite(w.resetsAt) || now >= w.resetsAt) {
    return { pct: 0, band: 0, resetsAt: w && finite(w.resetsAt) ? w.resetsAt : null, burn: null, etaAt: null };
  }
  const recent = (Array.isArray(samples) ? samples : []).filter((s) => finite(s.t) && finite(s.pct));
  const last = recent[recent.length - 1];
  const used = last ? recent.filter((s) => s.t >= last.t - BURN_LOOKBACK_MS) : [];
  const span = used.length ? last.t - used[0].t : 0;
  let burn = null, etaAt = null;
  if (used.length >= BURN_MIN_SAMPLES && span >= BURN_MIN_SPAN_MS) {
    burn = (last.pct - used[0].pct) / (span / 3600_000);
    if (burn > 0) etaAt = w.pct >= 98 ? now : now + ((98 - w.pct) / burn) * 3600_000;
    if (etaAt !== null && etaAt >= w.resetsAt) etaAt = null; // the window resets first
  }
  return { pct: w.pct, band: bandOf(w.pct), resetsAt: w.resetsAt, burn, etaAt };
}

function paceView(pace, now) {
  return {
    five_hour: windowView(pace && pace.five_hour, pace && pace.samples5h, now),
    seven_day: windowView(pace && pace.seven_day, pace && pace.samples7d, now),
  };
}

module.exports = { paceFile, recordPace, readPace, paceView, bandOf };
