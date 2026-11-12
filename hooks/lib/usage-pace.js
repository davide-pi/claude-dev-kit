/**
 * Usage pace for the hooks: what a chat or an agent is told when the account's 5h or 7d window crosses a band
 * (70, 85, 92, 96, 98), and the brake on new flows from 92. Data comes from the shared file the status line writes
 * (`statusline/pace.js`); the contract and the files are in docs/usage-pace.md.
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
const STALE_MS = 10 * MIN;
const MOD_ALIVE_MS = 3 * MIN;
const MARKER_TTL_MS = 7 * 24 * 60 * MIN;
const BANDS = [70, 85, 92, 96, 98];
const BRAKE_FROM = 92;
const FLOW_TOOLS = new Set(['Agent', 'Task', 'Workflow']);
const OVERRIDES = ['pace: owner asked', 'pace: finish'];
const WINDOW_NAME = { five_hour: '5h', seven_day: '7d' };
const PACE_STATE = '~/.claude/scripts/pace-state.mjs';
const RESUME_TASK = '~/.claude/scripts/resume-task.ps1';

const cachePath = (configDir, ...parts) => path.join(configDir, '.cache', ...parts);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit' });
const resetLabel = (ms, now) => (ms - now < 20 * 3600_000 ? hhmm(ms) : `${day(ms)} ${hhmm(ms)}`);

/** The pace data is usable only while the status line keeps it fresh. */
const isFresh = (pace, now) => Boolean(pace) && Number.isFinite(pace.updatedAt) && now - pace.updatedAt <= STALE_MS;

/** Windows as [key, view] pairs, the hotter first (band, then pct, then 5h). */
function windows(pace, now) {
  const v = paceView(pace, now);
  const list = [['five_hour', v.five_hour], ['seven_day', v.seven_day]];
  return list[1][1].band > list[0][1].band || (list[1][1].band === list[0][1].band && list[1][1].pct > list[0][1].pct)
    ? [list[1], list[0]] : list;
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

function noticeText(band, key, w, ctx) {
  const name = WINDOW_NAME[key];
  const head = `Usage pace: ${name} window at ${w.pct}%`;
  const reset = w.resetsAt ? `, resets ${resetLabel(w.resetsAt, ctx.now)}` : '';
  const burn = w.burn !== null && w.burn > 0
    ? `, burning ${w.burn.toFixed(1)}%/h${w.etaAt ? `, 98% around ${resetLabel(w.etaAt, ctx.now)}` : ''}`
    : '';
  const sid = ctx.sid;
  // Decided at 96, not at 92: right after --arm the mod's aliveAt can be up to 30 s stale, so a 92 check would see no mod and resume twice.
  const cron = ctx.modAlive
    ? 'The cockpit mod is alive: it resumes the chat, so CronDelete a resume prompt you created and create none. '
    : 'Then CronCreate a one-shot prompt at resumeAt (the --arm output gives its cron) to resume from the checkpoint. ';
  const arm = `Arm the resume: \`node ${PACE_STATE} --arm --session ${sid}\` (prints resumeAt and the checkpoint path), then \`pwsh -NoProfile -File ${RESUME_TASK} -SessionId ${sid}\`. `;
  const at96 = `Check the resume task exists (\`pwsh -NoProfile -File ${RESUME_TASK} -SessionId ${sid} -Check\`; create it when missing), update the checkpoint file, then \`node ${PACE_STATE} --ready --session ${sid}\`. ${cron}`
    + (ctx.modAlive ? 'The cockpit mod compacts after your turn. ' : 'Then ask the owner to run /compact. ');
  const disarm = `If the work finishes before the limit: \`node ${PACE_STATE} --done --session ${sid}\`, \`pwsh -NoProfile -File ${RESUME_TASK} -SessionId ${sid} -Remove\`, and CronDelete the resume prompt if you created one.`;
  // A jump past a band between two hook calls: the skipped band's actions were never told, so the notice carries them first.
  const catch92 = ctx.catchUp92 ? `Not armed yet. ${arm}Start no new flow and ask the running flows for their state. ` : '';
  const catch96 = ctx.catchUp96 ? at96 : '';
  switch (band) {
    case 70: return `${head}${reset}${burn}.`;
    case 85: return `${head}${reset}${burn}. Run fewer agents in parallel and pick smaller models where they are enough.`;
    case 92: return `${head}${reset}. Start no new flow (Agent, Task, Workflow). ${arm}Ask the running flows for their state and write it to the checkpoint file. ${disarm}`;
    case 96: return `${head}${reset}. ${catch92}${at96}${disarm}`;
    default: return `${head}${reset}. ${catch92}${catch96}Close the step in hand, stop the flows cleanly, do a last checkpoint update, then stop.`;
  }
}

const SUBAGENT_BAND = { 70: true, 85: true, 98: true };
const subagentText = (band, key, w, ctx) => (band === 98
  ? `Usage pace: ${WINDOW_NAME[key]} window at ${w.pct}%. Close your step now and report your state to the parent.`
  : noticeText(band, key, w, ctx));

/** The notice lines owed now: the highest unclaimed band of each window, lower bands claimed with it. */
function notices(input, ctx) {
  const agent = input.agent_id || 'main';
  const lines = [];
  for (const [key, w] of windows(ctx.pace, ctx.now)) {
    if (!w.band) continue;
    const owed = BANDS.filter((b) => b <= w.band && (!input.agent_id || SUBAGENT_BAND[b]));
    let top = 0;
    const told = new Set();
    for (const b of owed) {
      if (!claim(ctx.configDir, input.session_id, agent, key, w.resetsAt, b, ctx.now)) continue;
      top = b;
      told.add(b);
    }
    // Main loop only: 92 or 96 was claimed in this same call but the text goes out for a higher band.
    const catchUp92 = !input.agent_id && told.has(92) && top > 92;
    const catchUp96 = !input.agent_id && told.has(96) && top > 96;
    if (top) lines.push((input.agent_id ? subagentText : noticeText)(top, key, w, { ...ctx, sid: input.session_id, catchUp92, catchUp96 }));
  }
  return lines;
}

function brake(input, ctx) {
  if (input.agent_id || !FLOW_TOOLS.has(input.tool_name) || !isFresh(ctx.pace, ctx.now)) return null;
  const hot = windows(ctx.pace, ctx.now).find(([, w]) => w.band >= BRAKE_FROM);
  if (!hot) return null;
  const text = JSON.stringify(input.tool_input || {}).toLowerCase();
  if (OVERRIDES.some((o) => text.includes(o))) return null;
  return `Usage pace: the ${WINDOW_NAME[hot[0]]} window is at ${hot[1].pct}%, so no new flow starts. Finish the work in hand; if the owner wants it anyway, write \`pace: owner asked\` in the prompt, or \`pace: finish\` when the flow closes work already begun.`;
}

const ARMED_FOR_MS = 6 * 60 * MIN; // the resume task's own life: resumeAt + 6 h

/** The chat's pace state while it is armed: a checkpoint, not done, its resume not more than 6 hours past. */
const armed = (configDir, sid, now) => {
  const state = readJson(cachePath(configDir, 'pace', `${sid}.json`));
  if (!state || !state.checkpoint || state.done === true) return null;
  return Number.isFinite(state.resumeAt) && now > state.resumeAt + ARMED_FOR_MS ? null : state;
};

/** SessionStart after a resume or a compaction: where the checkpoint is and what to do first. */
function resumeContext(input, ctx) {
  const state = armed(ctx.configDir, input.session_id, ctx.now);
  if (!state) return null;
  return `Usage pace checkpoint: ${state.checkpoint}. Read it and verify the real state first (git status, the perimeter, the last gate), then continue. When the work is finished run \`node ${PACE_STATE} --done --session ${input.session_id}\` and \`pwsh -NoProfile -File ${RESUME_TASK} -SessionId ${input.session_id} -Remove\`, and CronDelete the resume prompt if you created one.`;
}

/** PreCompact stdout: the path first, verbatim, then the head of the checkpoint, so the summary keeps both. */
function compactContext(input, ctx) {
  const state = armed(ctx.configDir, input.session_id, ctx.now);
  if (!state) return null;
  let head = '';
  try { head = fs.readFileSync(state.checkpoint, 'utf8').split(/\r?\n/).slice(0, 20).join('\n'); } catch { /* not written yet */ }
  return `Keep this path verbatim in the summary, it is the usage-pace checkpoint: ${state.checkpoint}\n${head}`.trimEnd();
}

/**
 * PreCompact of an armed chat: records compactedAt in the chat's pace file (the launcher compacts a closed chat
 * headless before reopening it only when this is missing). Atomic rename; a failure is silent.
 */
function markCompacted(configDir, sid, now) {
  const file = cachePath(configDir, 'pace', `${sid}.json`);
  const state = armed(configDir, sid, now);
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

module.exports = { plan, notices, brake, claim, isFresh, modAlive, markCompacted, BANDS };
