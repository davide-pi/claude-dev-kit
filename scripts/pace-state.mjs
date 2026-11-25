#!/usr/bin/env node
// Chat-owned pace state: <config dir>/.cache/pace/<sid>.json (contract: docs/usage-pace.md).
//   node pace-state.mjs --arm --session <id> [--cwd <dir>]   from the shared usage file, on the window needing it with the later reset;
//                                                              prints resumeAt= (epoch ms), resumeAtLocal= (ISO, local offset), cron= (CronCreate),
//                                                              checkpoint=, prompt= (the resume cron's prompt) and, on a re-arm, note= (CronDelete the old cron; keep it when same window and reset)
//   node pace-state.mjs --ready|--show --session <id>
//   node pace-state.mjs --done --session <id>                 deletes the pace file (nothing left to resume); no-op when absent
// Any bad input: one line on stderr, exit 1, no file written.
import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const { readPace, paceView } = req(join(HERE, '..', 'statusline', 'pace.js'));
const { armWindows } = req(join(HERE, '..', 'hooks', 'lib', 'usage-pace.js'));

const MIN = 60_000;
const WEEK = 7 * 86_400_000;
const fail = (msg) => { console.error(`pace-state: ${msg}`); process.exit(1); };

const configDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const paceDir = () => join(configDir(), '.cache', 'pace');

function parseArgs(argv) {
  const modes = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--arm', '--ready', '--done', '--show'].includes(a)) modes.push(a.slice(2));
    else if (a === '--session' || a === '--cwd') { if (argv[i + 1] === undefined) fail(`${a} needs a value`); opts[a.slice(2)] = argv[++i]; }
    else fail(`unknown argument ${a}`);
  }
  if (modes.length !== 1) fail('give exactly one of --arm, --ready, --done, --show');
  if (!opts.session || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(opts.session) || opts.session.includes('..')) fail('--session needs a plain session id');
  return { mode: modes[0], sid: opts.session, cwd: opts.cwd ? resolve(opts.cwd) : process.cwd() };
}

function prune() {
  for (const dir of [paceDir(), join(configDir(), '.cache', 'resume')]) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      try { if (Date.now() - statSync(join(dir, n)).mtimeMs > WEEK) unlinkSync(join(dir, n)); } catch { /* gone or locked: next run */ }
    }
  }
}

function checkpointPath(cwd, sid) {
  const g = spawnSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8', windowsHide: true });
  const gitDir = g.status === 0 ? g.stdout.trim() : '';
  // Per session: two chats in one worktree must not share a checkpoint.
  return gitDir ? join(resolve(cwd, gitDir), 'deliver', `resume-${sid.slice(0, 8)}.md`) : join(configDir(), '.cache', 'resume', `${sid}.md`);
}

// A manual arm with no window at its arming band: the hotter window by band, ties by pct, then the 5h one.
function hotterWindow(pace) {
  const v = paceView(pace, Date.now());
  const a = v.five_hour, b = v.seven_day;
  return b.band > a.band || (b.band === a.band && b.pct > a.pct) ? ['seven_day', pace.seven_day] : ['five_hour', pace.five_hour];
}

/**
 * The prompt the resume cron sends: it opens with the words the cockpit mod recognises as a resume (`isResumePrompt`),
 * checks the credits first, and re-arms and stops when a window is still at its stop band. One line.
 */
const resumePrompt = (checkpoint, sid) => 'The usage window has reset. Read the checkpoint at ' + checkpoint
  + ', but first check the credits in ~/.claude/.usage-pace.json (five_hour.pct and seven_day.pct; a window whose resetsAt has passed counts as 0): '
  + 'if five_hour is at 98 or more, or seven_day at 99 or more, run `node ~/.claude/scripts/pace-state.mjs --arm --session ' + sid + '`, '
  + 'do what it prints (replace the old resume cron, create the new one with its prompt= line) and stop. '
  + 'Otherwise continue the work: check the real state (git status, the last test run) first. '
  + 'When the work is finished, run `node ~/.claude/scripts/pace-state.mjs --done --session ' + sid + '`.';

const stagger = (sid) => Math.floor(createHash('sha1').update(sid).digest().readUInt32BE(0) % 120) * 1000;

function writeAtomic(file, body) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(body)); renameSync(tmp, file); } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    fail(`cannot write ${file}: ${e.code || e.message}`);
  }
}

const pad = (n) => String(n).padStart(2, '0');
/** Local time with its offset, seconds precision: what a person and CronCreate read. */
function localIso(ms) {
  const d = new Date(ms), off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + `${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
/** A one-shot cron expression in local time (minute hour day month *). */
const cronAt = (ms) => { const d = new Date(ms); return `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`; };

function readState(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

const { mode, sid, cwd } = parseArgs(process.argv.slice(2));
prune();
const file = join(paceDir(), `${sid}.json`);

if (mode === 'arm') {
  const pace = readPace();
  if (!pace) fail('no usage file yet (the status line writes it)');
  // Among the windows that need arming the one that resets LATER (a 5h stop with the 7d near its own resumes at the 7d reset);
  // none needing it (a manual arm): the hotter one.
  const needing = armWindows(pace, Date.now());
  const window = needing.length ? needing.reduce((a, b) => (pace[b].resetsAt > pace[a].resetsAt ? b : a)) : hotterWindow(pace)[0];
  const w = pace[window];
  if (!w || !Number.isFinite(w.resetsAt)) fail('the usage file has no reset time');
  const old = readState(file);
  const same = old && old.window === window && old.resetsAt === w.resetsAt;
  const state = {
    v: 1, sessionId: sid, window, resetsAt: w.resetsAt, resumeAt: w.resetsAt + 2 * MIN + stagger(sid),
    checkpoint: checkpointPath(cwd, sid), ready: same ? old.ready === true : false,
    armedAt: same && Number.isFinite(old.armedAt) ? old.armedAt : Date.now(),
  };
  if (same && Number.isFinite(old.compactedAt)) state.compactedAt = old.compactedAt;
  writeAtomic(file, state);
  console.log(`resumeAt=${state.resumeAt}\nresumeAtLocal=${localIso(state.resumeAt)}\ncron=${cronAt(state.resumeAt)}\ncheckpoint=${state.checkpoint}\nprompt=${resumePrompt(state.checkpoint, sid)}`);
  if (same && Number.isFinite(old.resumeAt)) console.log('note=Already armed for this window and reset: keep the existing resume cron and create none.');
  else if (old && Number.isFinite(old.resumeAt)) console.log(`note=Re-armed on another window or reset: CronDelete the previous resume cron (it was set for ${localIso(old.resumeAt)}) before the CronCreate.`);
} else if (mode === 'done') {
  // The mod and the hook read a missing file as nothing to resume.
  try { unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') fail(`cannot delete ${file}: ${e.code || e.message}`); }
} else {
  const state = readState(file);
  if (!state) fail(`session ${sid} is not armed`);
  if (mode === 'show') console.log(JSON.stringify(state));
  else { writeAtomic(file, { ...state, [mode]: true }); }
}
