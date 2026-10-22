// Quick check of statusline.js against sample.json: no cockpit file, pane closed, tasks, pane open.
// Usage: node mods/cockpit/statusline/check.js   (runs the repo-root statusline.js on sample.json per case)
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, "sample.json"), "utf8"));
// The reset times are absolute: set them from now so the countdowns and the weekly pace have something to show.
const now = Math.floor(Date.now() / 1000);
sample.rate_limits.five_hour.resets_at = now + (2 * 60 + 14) * 60;
sample.rate_limits.seven_day.resets_at = now + Math.round(0.46 * 604800);

// Scratch config dir next to this file, removed at the end.
const configDir = path.join(__dirname, "tmp-config");
const cacheDir = path.join(configDir, ".cache");
const file = path.join(cacheDir, `cockpit-${sample.session_id}.json`);

const run = (label, payload = sample) => {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "..", "..", "statusline.js")], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, COLUMNS: "200" },
    encoding: "utf8",
  });
  console.log(`--- ${label}`);
  console.log(JSON.stringify(r.stdout));  // escapes visible
  console.log(r.stdout.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;]*m/g, ""));  // as read
  if (r.stderr) console.log("stderr:", r.stderr);
};

try {
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  run("no cockpit file");
  const state = { open: false, at: Date.now(), lastTurnUsd: 0.38, agents: { running: 2, modelWarnings: 1 }, effort: "high" };
  fs.writeFileSync(file, JSON.stringify(state));
  run("pane closed (open:false, +$0.38, 2 running, 1 warning)");
  // Line 2 (badges) and the zero-cost default: vim mode, a cold cache, no cost in the payload.
  run("pane closed, vim + cold cache + no cost (line 2 present, $0.00)", {
    ...sample, vim: { mode: "NORMAL" }, cost: {},
    prompt_cache: { caching_observed: true, warm: false, recache_tokens_if_cold: 248000 },
  });
  fs.writeFileSync(file, JSON.stringify({ ...state, tasks: { done: 3, total: 7 } }));
  run("pane closed, tasks 3/7 (after the agents badge)");
  fs.writeFileSync(file, JSON.stringify({ ...state, tasks: { done: 7, total: 7 } }));
  run("pane closed, tasks 7/7 (green)");
  fs.writeFileSync(file, JSON.stringify({ ...state, tasks: null }));
  run("pane closed, tasks null (no segment)");
  fs.writeFileSync(file, JSON.stringify({ ...state, open: true }));
  run("pane open (open:true: an empty line)");
  fs.writeFileSync(file, "{ not json");
  run("unreadable file (as no file)");
} finally {
  fs.rmSync(configDir, { recursive: true, force: true });
  console.log(`temp dir removed: ${!fs.existsSync(configDir)}`);
}
