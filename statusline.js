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
const path = require("node:path");
const { C, R, termWidth, visibleWidth, truncateAnsi } = require(path.join(__dirname, "statusline", "ansi.js"));
const { gitInfo, worktreeInfo } = require(path.join(__dirname, "statusline", "git.js"));
const {
  GIT_CACHE_MS, WORKTREE_CACHE_MS, cachedByCwd, saveContextSnapshot, pruneCache,
  saveRateLimitCache, reconcileCached, readSettings, readCockpit,
} = require(path.join(__dirname, "statusline", "cache.js"));
const {
  segFolder, segGit, segContext, segCacheCold, segRateWindows, segCost, segModel, segEffort,
  segAgents, segTasks, segWorklog, segVim, cockpitIsOpen,
} = require(path.join(__dirname, "statusline", "segments.js"));

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
  // (reserving 1 column for the ellipsis appended by truncateAnsi). Trailing segments are moved
  // or dropped whole before this; a head wider than the terminal is still cut here.
  const fit = (line) => {
    const width = visibleWidth(line);
    return width > W ? truncateAnsi(line, W - 1) : " ".repeat(W - width) + line;
  };
  const wide = (segs) => visibleWidth(segs.join(sepStr)) > W;

  // Line 1: what the session runs as, the workspace and the budgets. Line 2: badges, printed only when any.
  const head = [
    [segModel(modelName, modelStale), segEffort(effortLevel, effortStale)].filter(Boolean).join(" "),
    segFolder(cwd, cachedByCwd("worktree", cwd, WORKTREE_CACHE_MS, () => worktreeInfo(cwd))),
    segGit(cachedByCwd("git", cwd, GIT_CACHE_MS, () => gitInfo(cwd))),
    segContext(data.context_window),
  ].filter(Boolean);
  const tail = [
    ...segRateWindows(rl, rlStale),
    segCost(data.cost?.total_cost_usd, cockpit?.lastTurnUsd),
    segAgents(cockpit),
    segTasks(cockpit),
  ].filter(Boolean);
  const badges = [
    segWorklog(),
    segCacheCold(data.prompt_cache),
    segVim(data.vim),
  ].filter(Boolean);

  // Line 1 too wide: its trailing segments move to line 2, last first, instead of being cut mid-segment.
  const moved = [];
  while (tail.length && wide([...head, ...tail])) moved.unshift(tail.pop());
  // Line 2 too wide: whole segments are dropped from its end, only a lone one is cut.
  const second = [...moved, ...badges];
  while (second.length > 1 && wide(second)) second.pop();

  const lines = [[...head, ...tail], second].filter((segs) => segs.length).map((segs) => fit(segs.join(sepStr)));
  process.stdout.write(lines.join("\n") + "\n");
});
process.stdin.on("error", () => { process.stdout.write("\n"); });
