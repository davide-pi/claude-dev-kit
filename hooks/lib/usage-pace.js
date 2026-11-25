/**
 * Usage pace for the hooks: what a chat or an agent is told when the account's 5h or 7d window crosses one of its own
 * bands (5h 70, 85, 92, 96, 98; 7d 70, 85, 92, 96, 98, 99), and the brake on new flows. A conditional band slows the
 * chat only when the window is short: at the current burn it runs out before its reset. Data comes from the shared
 * file the status line writes (`statusline/pace.js`); the contract and the files are in docs/usage-pace.md.
 *
 * Pure decisions over an input and a context ({ now, pace, configDir }), plus the notice marker (a file created
 * with flag `wx`, so a band is told once per session, agent, window reset and band). Nothing here throws on a
 * missing or torn file: the caller fails open.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { paceView } = require('../../statusline/pace');

const MIN = 60_000;
const HOUR = 60 * MIN;
const STALE_MS = 10 * MIN;
const MOD_ALIVE_MS = 3 * MIN;
const MARKER_TTL_MS = 7 * 24 * HOUR;
// Per window: what each band does ('slow' and 'brake' only when short), and the runway (min) under which the run is fast.
const WINDOWS = {
  five_hour: { name: '5h', bands: [70, 85, 92, 96, 98], roles: { 70: 'notice', 85: 'slow', 92: 'brake', 96: 'close', 98: 'stop' }, fastMin: 30 },
  seven_day: { name: '7d', bands: [70, 85, 92, 96, 98, 99], roles: { 85: 'notice', 92: 'slow', 96: 'brake', 98: 'close', 99: 'stop' }, fastMin: 120 },
};
const SUBAGENT_ROLES = new Set(['notice', 'slow', 'stop']);
// A new Workflow is denied; one subagent at a time is still allowed (the notice says so).
const FLOW_TOOLS = new Set(['Workflow']);
const OVERRIDES = ['pace: owner asked', 'pace: finish'];
const PACE_STATE = '~/.claude/scripts/pace-state.mjs';

const roleBand = (cfg, role) => Number(Object.keys(cfg.roles).find((b) => cfg.roles[b] === role));

const cachePath = (configDir, ...parts) => path.join(configDir, '.cache', ...parts);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit' });
const resetLabel = (ms, now) => (ms - now < 20 * 3600_000 ? hhmm(ms) : `${day(ms)} ${hhmm(ms)}`);

/** The pace data is usable only while the status line keeps it fresh. */
const isFresh = (pace, now) => Boolean(pace) && Number.isFinite(pace.updatedAt) && now - pace.updatedAt <= STALE_MS;

/**
 * The window's view with the hook's own band: the highest band of its table reached, raised to the closing band on a fast
 * run. short: at the current burn it runs out before its reset (an unknown burn is not short); fast: short, with a runway
 * under the window's limit.
 */
function judged(key, v, now) {
  const cfg = WINDOWS[key];
  const hours = v.burn > 0 ? (100 - v.pct) / v.burn : Infinity;
  const short = Number.isFinite(hours) && Boolean(v.resetsAt) && hours * HOUR < v.resetsAt - now;
  const fast = short && hours * 60 < cfg.fastMin;
  const reached = cfg.bands.filter((b) => b <= v.pct).pop() || 0;
  return { ...v, band: fast ? Math.max(reached, roleBand(cfg, 'close')) : reached, short, fast };
}

/** Windows as [key, view] pairs, the hotter first (band, then pct, then 5h). */
function windows(pace, now) {
  const v = paceView(pace, now);
  const a = judged('five_hour', v.five_hour, now), b = judged('seven_day', v.seven_day, now);
  return b.band > a.band || (b.band === a.band && b.pct > a.pct) ? [['seven_day', b], ['five_hour', a]] : [['five_hour', a], ['seven_day', b]];
}

/** Keys of the windows whose resume is to be armed: short from the brake band, or from the closing band on. */
function armWindows(pace, now) {
  return windows(pace, now)
    .filter(([key, w]) => w.band >= roleBand(WINDOWS[key], 'close') || (w.band >= roleBand(WINDOWS[key], 'brake') && w.short))
    .map(([key]) => key);
}

/** True when the chat's pace file is on the window and reset that --arm would choose now: the later reset among armWindows. */
function covers(state, ctx) {
  if (!state) return false;
  const v = paceView(ctx.pace, ctx.now);
  const target = armWindows(ctx.pace, ctx.now).map((key) => [key, v[key].resetsAt]).sort((a, b) => b[1] - a[1])[0];
  return Boolean(target) && state.window === target[0] && state.resetsAt === target[1];
}

function modAlive(configDir, sid, now) {
  const mod = readJson(cachePath(configDir, 'pace', `${sid}.mod.json`));
  return Boolean(mod) && Number.isFinite(mod.aliveAt) && now - mod.aliveAt < MOD_ALIVE_MS;
}

/** True the first time a (session, agent, window, reset, band) is claimed, false after. Old markers are pruned on a claim. */
function claim(configDir, sid, agent, window, resetsAt, band, now) {
  const dir = cachePath(configDir, 'pace-notices');
  const name = crypto.createHash('sha1').update([sid, agent, window, resetsAt, band].join('|')).digest('hex').slice(0, 24);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.closeSync(fs.openSync(path.join(dir, name), 'wx'));
  } catch {
    return false; // already told (EEXIST) or no cache to write: silence either way
  }
  try {
    for (const n of fs.readdirSync(dir)) {
      const f = path.join(dir, n);
      if (now - fs.statSync(f).mtimeMs > MARKER_TTL_MS) fs.unlinkSync(f);
    }
  } catch { /* pruned next time */ }
  return true;
}

function noticeText(role, key, w, ctx) {
  const cfg = WINDOWS[key];
  const head = `Usage pace: ${cfg.name} window at ${w.pct}%`;
  const reset = w.resetsAt ? `, resets ${resetLabel(w.resetsAt, ctx.now)}` : '';
  // Every notice carries the burn and when each next band would come at that rate (bands after the reset are left out).
  const next = w.burn !== null && w.burn > 0
    ? cfg.bands.filter((b) => b > w.pct).map((b) => [b, ctx.now + ((b - w.pct) / w.burn) * HOUR])
      .filter(([, at]) => !w.resetsAt || at < w.resetsAt).map(([b, at]) => `${b}% ~${resetLabel(at, ctx.now)}`)
    : [];
  const burn = w.burn !== null && w.burn > 0
    ? `, burning ${w.burn.toFixed(1)}%/h${next.length ? `, next: ${next.join(', ')}` : ''}`
    : '';
  const lead = `${head}${reset}${burn}.`;
  const sid = ctx.sid;
  const arm = `Arm the resume: \`node ${PACE_STATE} --arm --session ${sid}\` (prints resumeAt, cron=, prompt= and the checkpoint path; for another window or reset than a previous arm it also says to CronDelete the previous resume cron, for the same one to keep the existing cron: follow its note= line), then CronCreate a one-shot prompt at resumeAt with that cron and the prompt= line as its prompt. `;
  const disarm = `If the work finishes before the limit: \`node ${PACE_STATE} --done --session ${sid}\` and CronDelete the resume prompt.`;
  const close = `Close the step in hand cleanly, stop the flows without leaving work half-written. Update the checkpoint file, then \`node ${PACE_STATE} --ready --session ${sid}\`. `;
  // A jump past the arming band: the notice carries the arm first, once per window and reset.
  const armed = ctx.needArm ? `Not armed yet. ${arm}Start no new flow and ask the running flows for their state. ` : '';
  if (role === 'notice' || ((role === 'slow' || role === 'brake') && !w.short)) return lead;
  switch (role) {
    case 'slow': return `${lead} Weigh the burn since the last notice: run fewer agents in parallel, or slow down, so the work in hand ends before the limit; keep the same models (quality first).`;
    case 'brake': return `${lead} Finish the work in hand: no new Workflow, only small steps, one subagent at a time, no critical operation (merge, push, migration, deploy, delete). ${arm}Ask the running flows for their state and write it to the checkpoint file. ${disarm}`;
    case 'close': return `${lead} ${armed}${close}${disarm}`;
    default: return `${lead} ${armed}${ctx.catchClose ? close : 'Do a last checkpoint update. '}Stop: compact, save state, wait for the cron. `
      + (ctx.modAlive ? 'The cockpit mod compacts at the reset and the cron resumes the chat.' : 'Ask the owner to run /compact, then wait for the cron.');
  }
}

const subagentText = (role, key, w, ctx) => (role === 'stop'
  ? `Usage pace: ${WINDOWS[key].name} window at ${w.pct}%. Close your step now and report your state to the parent.`
  : noticeText(role, key, w, ctx));

/** The notice lines owed now: the highest unclaimed band of each window, lower bands claimed with it. */
function notices(input, ctx) {
  const agent = input.agent_id || 'main';
  const lines = [];
  for (const [key, w] of windows(ctx.pace, ctx.now)) {
    const cfg = WINDOWS[key];
    const owed = cfg.bands.filter((b) => b <= w.band && cfg.roles[b] && (!input.agent_id || SUBAGENT_ROLES.has(cfg.roles[b])));
    let top = 0;
    const told = new Set();
    for (const b of owed) {
      // A conditional band is owed again, in full, once the window turns short after a notice-only claim, but only while
      // it is the highest band reached: under a close or stop already due it would arrive as a lower, later instruction.
      const conditional = cfg.roles[b] === 'slow' || cfg.roles[b] === 'brake';
      const again = conditional && w.short && (cfg.roles[w.band] === 'slow' || cfg.roles[w.band] === 'brake');
      const plain = claim(ctx.configDir, input.session_id, agent, key, w.resetsAt, b, ctx.now);
      const full = again && claim(ctx.configDir, input.session_id, agent, key, w.resetsAt, `${b}:short`, ctx.now);
      if (!(again ? full : plain)) continue;
      top = b;
      told.add(b);
    }
    if (!top) continue;
    const role = cfg.roles[top];
    // Main loop only: a closing or stop band tells the arm unless the chat's pace file is on the window --arm would pick now
    // (among the windows that need arming, the later reset); a pace file removed by --done covers nothing.
    const state = input.agent_id ? null : armed(ctx.configDir, input.session_id);
    const needArm = !input.agent_id && (role === 'close' || role === 'stop') && !covers(state, ctx);
    const catchClose = !input.agent_id && role === 'stop' && told.has(roleBand(cfg, 'close'));
    lines.push((input.agent_id ? subagentText : noticeText)(role, key, w, { ...ctx, sid: input.session_id, needArm, catchClose }));
  }
  return lines;
}

function brake(input, ctx) {
  if (input.agent_id || !FLOW_TOOLS.has(input.tool_name) || !isFresh(ctx.pace, ctx.now)) return null;
  const hot = windows(ctx.pace, ctx.now).find(([key, w]) => w.band >= roleBand(WINDOWS[key], 'stop') || (w.band >= roleBand(WINDOWS[key], 'brake') && w.short));
  if (!hot) return null;
  const text = JSON.stringify(input.tool_input || {}).toLowerCase();
  if (OVERRIDES.some((o) => text.includes(o))) return null;
  return `Usage pace: the ${WINDOWS[hot[0]].name} window is at ${hot[1].pct}%, so no new flow starts. Finish the work in hand; if the owner wants it anyway, write \`pace: owner asked\` in the prompt, or \`pace: finish\` when the flow closes work already begun.`;
}

/**
 * The chat's pace state while it is armed: a checkpoint, not done. A closed chat reopens only by hand, any time
 * later, so the file lives until `--done` or the 7-day prune of pace-state.mjs.
 */
const armed = (configDir, sid) => {
  const state = readJson(cachePath(configDir, 'pace', `${sid}.json`));
  return !state || !state.checkpoint || state.done === true ? null : state;
};

/** SessionStart after a resume or a compaction: where the checkpoint is and what to do first. */
function resumeContext(input, ctx) {
  const state = armed(ctx.configDir, input.session_id);
  if (!state) return null;
  return `Usage pace checkpoint: ${state.checkpoint}. Read it and verify the real state first (git status, the last test run), then continue. When the work is finished run \`node ${PACE_STATE} --done --session ${input.session_id}\` and CronDelete the resume prompt if you created one.`;
}

/** PreCompact stdout: the path first, verbatim, then the head of the checkpoint, so the summary keeps both. */
function compactContext(input, ctx) {
  const state = armed(ctx.configDir, input.session_id);
  if (!state) return null;
  let head = '';
  try { head = fs.readFileSync(state.checkpoint, 'utf8').split(/\r?\n/).slice(0, 20).join('\n'); } catch { /* not written yet */ }
  return `Keep this path verbatim in the summary, it is the usage-pace checkpoint: ${state.checkpoint}\n${head}`.trimEnd();
}

/**
 * PreCompact of an armed chat: records compactedAt in the chat's pace file, which the cockpit mod reads to skip a
 * compaction already done. Atomic rename; a failure is silent.
 */
function markCompacted(configDir, sid, now) {
  const file = cachePath(configDir, 'pace', `${sid}.json`);
  const state = armed(configDir, sid);
  if (!state) return;
  const tmp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify({ ...state, compactedAt: now })); fs.renameSync(tmp, file); } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
  }
}

/** What the hook prints for one payload: { json } for hook output, { text } for PreCompact stdout, or null. */
function plan(input, ctx) {
  const event = input.hook_event_name;
  if (!input.session_id) return null;
  if (event === 'SessionStart') {
    if (input.source !== 'resume' && input.source !== 'compact') return null;
    const text = resumeContext(input, ctx);
    return text && { json: { hookSpecificOutput: { hookEventName: event, additionalContext: text } } };
  }
  if (event === 'PreCompact') {
    const text = compactContext(input, ctx);
    return text && { text };
  }
  if (event !== 'PreToolUse' && event !== 'UserPromptSubmit') return null;
  if (!isFresh(ctx.pace, ctx.now)) return null;
  if (event === 'PreToolUse') {
    const reason = brake(input, ctx);
    if (reason) return { json: { hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason } } };
  }
  const lines = notices(input, { ...ctx, modAlive: modAlive(ctx.configDir, input.session_id, ctx.now) });
  return !lines.length ? null : { json: { hookSpecificOutput: { hookEventName: event, additionalContext: lines.join('\n') } } };
}

module.exports = { plan, notices, brake, claim, isFresh, modAlive, markCompacted, armWindows };
