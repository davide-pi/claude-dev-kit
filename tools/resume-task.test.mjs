#!/usr/bin/env node
/**
 * Tests for scripts/resume-task.ps1. Zero dependencies, `node:test` on Node 18+, plus pwsh 7.
 * Every case runs with -DryRun or -TasksJson (which implies it) and with CLAUDE_PACE_NO_SCHEDULER set, so a script
 * that would reach the scheduler stops with exit 1 instead: no scheduled task is ever registered or removed here.
 *
 *   node --test "tools/*.test.mjs"
 *
 * Contract used here:
 *   resume-task.ps1 -SessionId <sid> -DryRun [-TasksJson <file>]   prints one JSON line:
 *     { name, taskPath, dryRun, trigger: { type, at }, endBoundary, deleteExpiredTaskAfter, startWhenAvailable,
 *       disallowStartIfOnBatteries, stopIfGoingOnBatteries, execute, arguments, sweep, overwrites, refused, message };
 *     exit 1 when refused
 *   resume-task.ps1 -SessionId <sid> -Check|-Remove -DryRun          "exists"/exit 0, "missing"/exit 1 | { remove: [name] }
 *   resume-task.ps1 -Sweep -DryRun [-TasksJson <file>]             prints { remove: [names] }
 * -TasksJson is the faked task list: [{ name, endBoundary }] (ISO strings) used instead of Get-ScheduledTask.
 * resumeAt and the pace files come from <CLAUDE_CONFIG_DIR>/.cache/pace/<sid>.json (epoch ms).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'resume-task.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const skip = hasPwsh ? false : 'pwsh 7 not on PATH';

const HOUR = 3600_000;
const SID = '4ee9b1db-a8d6-4424-9eac-cf3c928abb54';
const iso = (ms) => new Date(ms).toISOString();

/** A config dir with pace files ({ sid: object }) and a faked task list; fn gets (dir, run). */
function withEnv({ pace = {}, tasks }, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'resume-task-'));
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  for (const [sid, body] of Object.entries(pace)) writeFileSync(join(dir, '.cache', 'pace', `${sid}.json`), JSON.stringify(body));
  const list = join(dir, 'tasks.json');
  writeFileSync(list, JSON.stringify(tasks ?? []));
  const run = (...args) => spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, ...args, '-DryRun', '-TasksJson', list], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PACE_NO_SCHEDULER: '1' },
  });
  run.noDryRun = (...args) => spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, ...args, '-TasksJson', list], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PACE_NO_SCHEDULER: '1' },
  });
  try { return fn(dir, run); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const json = (r) => JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
const armed = (sid, resumeAt, extra = {}) => ({ v: 1, sessionId: sid, window: 'five_hour', resetsAt: resumeAt - 120_000, resumeAt, checkpoint: 'x.md', ready: false, ...extra });

test('Given an armed session, When -DryRun runs, Then it prints the exact task definition', { skip }, () => {
  const resumeAt = Date.now() + 2 * HOUR;
  withEnv({ pace: { [SID]: armed(SID, resumeAt) } }, (dir, run) => {
    // Given / When
    const r = run('-SessionId', SID);
    // Then
    assert.equal(r.status, 0, r.stderr);
    const d = json(r);
    assert.equal(d.taskPath, '\\');
    assert.equal(d.name, 'claude-resume-4ee9b1db');
    assert.equal(d.trigger.type, 'once');
    const sec = (ms) => ms - (ms % 1000);
    assert.equal(Date.parse(d.trigger.at), sec(resumeAt));
    assert.equal(Date.parse(d.endBoundary), sec(resumeAt + 6 * HOUR));
    assert.equal(d.deleteExpiredTaskAfter, 'PT0S');
    assert.equal(d.startWhenAvailable, true);
    assert.equal(d.disallowStartIfOnBatteries, false);
    assert.equal(d.stopIfGoingOnBatteries, false);
    assert.equal(d.dryRun, true);
    assert.equal(d.execute, 'pwsh');
    assert.match(d.arguments, /^-NoProfile -File "[^"]*resume-launch\.ps1" -SessionId "4ee9b1db-a8d6-4424-9eac-cf3c928abb54"/);
    assert.equal(d.overwrites, false);
    assert.equal(d.refused, false);
  });
});

test('Given a task with the same name exists, When -DryRun runs, Then it overwrites that task and is not refused', { skip }, () => {
  const resumeAt = Date.now() + 2 * HOUR;
  const tasks = ['claude-resume-4ee9b1db', 'claude-resume-aaaaaaa1', 'claude-resume-aaaaaaa2', 'claude-resume-aaaaaaa3', 'claude-resume-aaaaaaa4']
    .map((name) => ({ name, endBoundary: iso(resumeAt + HOUR) }));
  withEnv({ pace: { [SID]: armed(SID, resumeAt) }, tasks }, (dir, run) => {
    // Given / When
    const r = run('-SessionId', SID);
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(json(r).overwrites, true);
    assert.equal(json(r).refused, false);
  });
});

test('Given 5 other claude-resume tasks, When -DryRun runs for a new session, Then it is refused with a message', { skip }, () => {
  const resumeAt = Date.now() + 2 * HOUR;
  const tasks = [1, 2, 3, 4, 5].map((i) => ({ name: `claude-resume-bbbbbbb${i}`, endBoundary: iso(resumeAt + HOUR) }));
  tasks.push({ name: 'someone-elses-task', endBoundary: iso(resumeAt + HOUR) });
  const pace = { [SID]: armed(SID, resumeAt) };
  for (const i of [1, 2, 3, 4, 5]) pace[`bbbbbbb${i}-0000-0000-0000-000000000000`] = armed(`bbbbbbb${i}-0000-0000-0000-000000000000`, resumeAt);
  withEnv({ pace, tasks }, (dir, run) => {
    // Given / When
    const r = run('-SessionId', SID);
    // Then
    assert.notEqual(r.status, 0);
    const d = json(r);
    assert.equal(d.refused, true);
    assert.match(d.message, /5/);
  });
});

test('Given 4 claude-resume tasks and 2 foreign ones, When -DryRun runs for a new session, Then it is not refused', { skip }, () => {
  const resumeAt = Date.now() + 2 * HOUR;
  const live = (i) => `cccccc0${i}-0000-0000-0000-000000000000`;
  const tasks = [1, 2, 3, 4].map((i) => ({ name: `claude-resume-cccccc0${i}`, endBoundary: iso(resumeAt + HOUR) }));
  tasks.push({ name: 'someone-elses-task', endBoundary: iso(resumeAt + HOUR) }, { name: 'another-task', endBoundary: iso(resumeAt + HOUR) });
  const pace = { [SID]: armed(SID, resumeAt) };
  for (const i of [1, 2, 3, 4]) pace[live(i)] = armed(live(i), resumeAt);
  withEnv({ pace, tasks }, (dir, run) => {
    // Given / When
    const r = run('-SessionId', SID);
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(json(r).refused, false);
  });
});

test('Given 5 claude-resume tasks of which one expired, When a new session creates its task, Then the expired one is swept and not counted', { skip }, () => {
  const resumeAt = Date.now() + 2 * HOUR;
  const live = (i) => `dddddd0${i}-0000-0000-0000-000000000000`;
  const tasks = [1, 2, 3, 4].map((i) => ({ name: `claude-resume-dddddd0${i}`, endBoundary: iso(resumeAt + HOUR) }));
  tasks.push({ name: 'claude-resume-eeeeeeee', endBoundary: iso(Date.now() - HOUR) });
  const pace = { [SID]: armed(SID, resumeAt) };
  for (const i of [1, 2, 3, 4]) pace[live(i)] = armed(live(i), resumeAt);
  withEnv({ pace, tasks }, (dir, run) => {
    // Given / When
    const r = run('-SessionId', SID);
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(json(r).refused, false);
    assert.deepEqual(json(r).sweep, ['claude-resume-eeeeeeee']);
  });
});

test('Given a pace file whose resume is more than 6 hours past, When the task is created, Then it is refused (no task born expired)', { skip }, () => {
  withEnv({ pace: { [SID]: armed(SID, Date.now() - 7 * HOUR) } }, (dir, run) => {
    // Given / When
    const r = run('-SessionId', SID);
    // Then
    assert.equal(r.status, 1);
    assert.match(r.stderr, /arm again/);
  });
});

test('Given -TasksJson without -DryRun, When the task is created, Then it still runs dry and never reaches the scheduler', { skip }, () => {
  withEnv({ pace: { [SID]: armed(SID, Date.now() + 2 * HOUR) } }, (dir, run) => {
    // Given / When
    const r = run.noDryRun('-SessionId', SID);
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(json(r).dryRun, true);
  });
});

test('Given the task exists or not, When -Check runs, Then it prints exists with exit 0 or missing with exit 1; -Remove names the task', { skip }, () => {
  const tasks = [{ name: 'claude-resume-4ee9b1db', endBoundary: iso(Date.now() + HOUR) }];
  withEnv({ tasks }, (dir, run) => {
    // Given / When
    const r = run('-SessionId', SID, '-Check');
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'exists');
  });
  withEnv({ tasks: [] }, (dir, run) => {
    // Given / When
    const r = run('-SessionId', SID, '-Check');
    const rm = run('-SessionId', SID, '-Remove');
    // Then
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), 'missing');
    assert.equal(rm.status, 0, rm.stderr);
    assert.deepEqual(json(rm).remove, ['claude-resume-4ee9b1db']);
  });
});

test('Given tasks of several kinds, When -Sweep -DryRun runs, Then only expired or orphaned or done claude-resume tasks are selected', { skip }, () => {
  const now = Date.now();
  const future = iso(now + 3 * HOUR);
  const past = iso(now - HOUR);
  const tasks = [
    { name: 'claude-resume-aaaa1111', endBoundary: past },
    { name: 'claude-resume-bbbb2222', endBoundary: future },
    { name: 'claude-resume-cccc3333', endBoundary: future },
    { name: 'claude-resume-dddd4444', endBoundary: future },
    { name: 'other-task-past', endBoundary: past },
    { name: 'other-task-nopace', endBoundary: future },
  ];
  const pace = {
    'aaaa1111-0000-0000-0000-000000000000': armed('aaaa1111-0000-0000-0000-000000000000', now + HOUR),
    'bbbb2222-0000-0000-0000-000000000000': armed('bbbb2222-0000-0000-0000-000000000000', now + HOUR),
    'dddd4444-0000-0000-0000-000000000000': armed('dddd4444-0000-0000-0000-000000000000', now + HOUR, { done: true }),
  };
  withEnv({ pace, tasks }, (dir, run) => {
    // Given / When
    const r = run('-Sweep');
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(json(r).remove.slice().sort(), ['claude-resume-aaaa1111', 'claude-resume-cccc3333', 'claude-resume-dddd4444']);
  });
});

// resume-launch.ps1: every case runs with -DryRun (or exits on the session id first) and CLAUDE_PACE_NO_SCHEDULER set.
const LAUNCH = join(ROOT, 'scripts', 'resume-launch.ps1');
const LSID = 'ab12cd34-0000-4000-8000-00000000000a';

function launch(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'resume-launch-'));
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body)); // a string is written raw
  }
  const run = (sid = LSID, ...extra) => spawnSync('pwsh', ['-NoProfile', '-File', LAUNCH, '-SessionId', sid, ...extra], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PACE_NO_SCHEDULER: '1' },
  });
  try { return fn(dir, run); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const paceFile = (extra = {}) => ({ ['.cache/pace/' + LSID + '.json']: armed(LSID, Date.now(), extra) });

test('Given a session id that is not a plain id, When the launcher runs, Then it exits 1 and opens nothing', { skip }, () => {
  launch({}, (dir, run) => {
    // Given / When
    const r = run('bad id');
    // Then
    assert.equal(r.status, 1);
  });
});

// resume-launch.ps1 -DryRun: one JSON line and no side effect (no task deleted, no window opened).
//   { decision: 'open'|'alive'|'mod-alive'|'done'|'no-pace'|'doubt', steps: [...], deleteTask: name, compact: string|null,
//     command: string|null }
// `steps` starts with 'delete-task' on every path (the task goes first), has 'compact' when the chat was not compacted
// since it was armed, and ends with 'open' only when a window would open.
const TASK = 'claude-resume-ab12cd34';
const transcript = (cwd) => ({ [`projects/p1/${LSID}.jsonl`]: JSON.stringify({ type: 'user', cwd }) });
const tree = (dir) => readdirSync(dir, { recursive: true }).sort().join('|');

test('Given an armed closed chat, When -DryRun runs, Then it prints the delete-then-open plan with the wt command and touches nothing', { skip }, () => {
  launch({ ...paceFile({ checkpoint: 'C:\\a;b\\resume.md', armedAt: Date.now() - 60_000, compactedAt: Date.now() }) }, (dir, run) => {
    // Given
    mkdirSync(join(dir, 'projects', 'p1'), { recursive: true });
    writeFileSync(join(dir, 'projects', 'p1', `${LSID}.jsonl`), JSON.stringify({ type: 'user', cwd: dir }));
    const before = tree(dir);
    // When
    const r = run(LSID, '-DryRun');
    // Then
    assert.equal(r.status, 0, r.stderr);
    const d = json(r);
    assert.equal(d.decision, 'open');
    assert.deepEqual(d.steps, ['delete-task', 'open']);
    assert.equal(d.deleteTask, TASK);
    assert.match(d.command, /^wt(\.exe)? /);
    assert.ok(d.command.includes(`-d "${dir}"`), d.command);
    assert.ok(d.command.includes(`claude --resume ${LSID}`), d.command);
    assert.ok(d.command.includes('C:\\a\\;b\\resume.md'), 'the backslashes reach wt and the ; is escaped');
    assert.equal(d.compact, null);
    assert.equal(/(?<!\\);/.test(d.command), false, 'no bare ; reaches wt');
    assert.equal(tree(dir), before);
  });
});

test('Given a chat not compacted since it was armed, When -DryRun runs, Then it plans a headless compaction before opening', { skip }, () => {
  const now = Date.now();
  const cases = [
    paceFile({ armedAt: now - 60_000 }),
    paceFile({ armedAt: now - 60_000, compactedAt: now - 120_000 }),
  ];
  for (const files of cases) {
    launch({ ...files, ...transcript(tmpdir()) }, (dir, run) => {
      // Given / When
      const d = json(run(LSID, '-DryRun'));
      // Then
      assert.equal(d.decision, 'open');
      assert.deepEqual(d.steps, ['delete-task', 'compact', 'open']);
      assert.equal(d.compact, `claude -p --resume ${LSID} /compact`);
    });
  }
  // Given the mod compacted it after the arm
  launch({ ...paceFile({ armedAt: now - 60_000 }), ...transcript(tmpdir()), ['.cache/pace/' + LSID + '.mod.json']: { v: 1, aliveAt: now - 10 * 60_000, compactedAt: now - 30_000 } }, (dir, run) => {
    // When
    const d = json(run(LSID, '-DryRun'));
    // Then
    assert.deepEqual(d.steps, ['delete-task', 'open']);
  });
});

test('Given a transcript whose folder is a drive root, When -DryRun runs, Then the -d argument does not end in a quote-escaping backslash', { skip }, () => {
  const root = process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\';
  launch({ ...paceFile({ armedAt: Date.now() - 60_000, compactedAt: Date.now() }), ...transcript(root) }, (dir, run) => {
    // Given / When
    const d = json(run(LSID, '-DryRun'));
    // Then
    assert.equal(d.decision, 'open');
    assert.ok(d.command.includes(`-d "${root}."`), d.command);
  });
});

test('Given a done chat, no pace file or a live mod, When -DryRun runs, Then it plans only the task deletion and no command', { skip }, () => {
  const cases = [
    ['done', paceFile({ done: true })],
    ['no-pace', {}],
    ['mod-alive', { ...paceFile(), ...transcript(tmpdir()), ['.cache/pace/' + LSID + '.mod.json']: { v: 1, aliveAt: Date.now() - 60_000 } }],
  ];
  for (const [decision, files] of cases) {
    launch(files, (dir, run) => {
      // Given / When
      const r = run(LSID, '-DryRun');
      // Then
      assert.equal(r.status, 0, r.stderr);
      const d = json(r);
      assert.equal(d.decision, decision);
      assert.deepEqual(d.steps, ['delete-task']);
      assert.equal(d.deleteTask, TASK);
      assert.equal(d.command, null);
    });
  }
});

test('Given a stale mod, When -DryRun runs, Then the mod does not hold the launcher back', { skip }, () => {
  launch({ ...paceFile(), ...transcript(tmpdir()), ['.cache/pace/' + LSID + '.mod.json']: { v: 1, aliveAt: Date.now() - 10 * 60_000 } }, (dir, run) => {
    // Given / When
    const r = run(LSID, '-DryRun');
    // Then
    assert.equal(json(r).decision, 'open');
  });
});

test('Given a live process whose start matches the session file, When -DryRun runs, Then the decision is alive and no command is planned', { skip }, () => {
  // Given
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)'], { stdio: 'ignore' });
  try {
    const procStart = spawnSync('pwsh', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).StartTime.ToFileTime()`], { encoding: 'utf8' }).stdout.trim();
    launch({ ...paceFile(), ...transcript(tmpdir()), [`sessions/${child.pid}.json`]: { pid: child.pid, sessionId: LSID, procStart } }, (dir, run) => {
      // When
      const d = json(run(LSID, '-DryRun'));
      // Then
      assert.equal(d.decision, 'alive');
      assert.deepEqual(d.steps, ['delete-task']);
      assert.equal(d.command, null);
    });
  } finally { child.kill(); }
});

test('Given a session file that cannot be read or no transcript, When -DryRun runs, Then the decision is doubt and nothing opens', { skip }, () => {
  const cases = [
    { ...paceFile(), ...transcript(tmpdir()), 'sessions/1.json': '{not json' },
    { ...paceFile() },
  ];
  for (const files of cases) {
    launch(files, (dir, run) => {
      // Given / When
      const d = json(run(LSID, '-DryRun'));
      // Then
      assert.equal(d.decision, 'doubt');
      assert.deepEqual(d.steps, ['delete-task']);
      assert.equal(d.command, null);
    });
  }
});
