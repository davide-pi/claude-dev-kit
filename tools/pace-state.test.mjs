#!/usr/bin/env node
/**
 * Tests for scripts/pace-state.mjs, the chat-owned <CLAUDE_CONFIG_DIR>/.cache/pace/<sid>.json.
 * Zero dependencies, `node:test` on Node 18+. Each case gets its own CLAUDE_CONFIG_DIR.
 *
 *   node --test "tools/*.test.mjs"
 *
 * Contract used here: `--arm --session <id> [--cwd <dir>]`, `--ready --session <id>`, `--done --session <id>`,
 * `--show --session <id>`; times are epoch ms; the window armed is the one with the higher band (ties: higher pct);
 * stdout of --arm has the lines `resumeAt=<ms>` and `checkpoint=<path>`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, utimesSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'pace-state.mjs');
const MIN = 60_000;
const SID = '4ee9b1db-a8d6-4424-9eac-cf3c928abb54';

const shared = (p5, p7) => ({
  v: 1, updatedAt: Date.now(), writer: 'statusline',
  five_hour: { pct: p5, resetsAt: Date.now() + 2 * 3600_000 },
  seven_day: { pct: p7, resetsAt: Date.now() + 3 * 86_400_000 },
  samples5h: [], samples7d: [],
});

/** A config dir holding the shared file; fn gets (dir, run) where run(...args) returns the spawn result. */
function withDir(sharedFile, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pace-state-'));
  if (sharedFile) writeFileSync(join(dir, '.usage-pace.json'), JSON.stringify(sharedFile));
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  });
  try { return fn(dir, run); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const paceFile = (dir, sid = SID) => join(dir, '.cache', 'pace', `${sid}.json`);
const out = (r, key) => r.stdout.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);

test('Given the 5h window is the hotter one, When --arm runs, Then the file has the schema from the shared file', () => {
  const sh = shared(93, 50);
  withDir(sh, (dir, run) => {
    // Given / When
    const r = run('--arm', '--session', SID, '--cwd', dir);
    // Then
    assert.equal(r.status, 0, r.stderr);
    const got = JSON.parse(readFileSync(paceFile(dir), 'utf8'));
    assert.equal(got.v, 1);
    assert.equal(got.sessionId, SID);
    assert.equal(got.window, 'five_hour');
    assert.equal(got.resetsAt, sh.five_hour.resetsAt);
    assert.equal(got.ready, false);
    assert.ok(got.resumeAt >= got.resetsAt + 2 * MIN && got.resumeAt < got.resetsAt + 4 * MIN, `resumeAt ${got.resumeAt}`);
    assert.equal(out(r, 'resumeAt'), String(got.resumeAt));
    assert.equal(Date.parse(out(r, 'resumeAtLocal')), got.resumeAt - (got.resumeAt % 1000));
    assert.match(out(r, 'resumeAtLocal'), /T\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    const d = new Date(got.resumeAt);
    assert.equal(out(r, 'cron'), `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`);
    assert.ok(Number.isFinite(got.armedAt));
    assert.equal(resolve(out(r, 'checkpoint')), resolve(got.checkpoint));
  });
});

test('Given the 7d window is the hotter one, When --arm runs, Then it arms the 7d window', () => {
  withDir(shared(93, 97), (dir, run) => {
    // Given / When
    const r = run('--arm', '--session', SID, '--cwd', dir);
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(paceFile(dir), 'utf8')).window, 'seven_day');
  });
});

test('Given several sessions, When armed, Then resumeAt is staggered within 2 min and stable per session', () => {
  const sh = shared(93, 10);
  withDir(sh, (dir, run) => {
    // Given / When
    const at = (sid) => { run('--arm', '--session', sid, '--cwd', dir); return JSON.parse(readFileSync(paceFile(dir, sid), 'utf8')).resumeAt; };
    const sids = Array.from({ length: 12 }, (_, i) => `sess-${i}-${'x'.repeat(i)}`);
    const first = sids.map(at);
    const again = sids.map(at);
    // Then
    assert.deepEqual(first, again);
    assert.ok(new Set(first).size > 1, 'all sessions got the same resumeAt');
    for (const t of first) assert.ok(t >= sh.five_hour.resetsAt + 2 * MIN && t < sh.five_hour.resetsAt + 4 * MIN);
  });
});

test('Given a cwd inside a repo, When --arm runs, Then the checkpoint is <git-dir>/deliver/resume-<id8>.md', () => {
  withDir(shared(93, 10), (dir, run) => {
    // Given
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    // When
    const r = run('--arm', '--session', SID, '--cwd', repo);
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(resolve(out(r, 'checkpoint')), resolve(repo, '.git', 'deliver', 'resume-4ee9b1db.md'));
  });
});

test('Given a cwd outside any repo, When --arm runs, Then the checkpoint is under .cache/resume/<sid>.md', () => {
  withDir(shared(93, 10), (dir, run) => {
    // Given
    const plain = join(dir, 'plain');
    mkdirSync(plain);
    // When
    const r = run('--arm', '--session', SID, '--cwd', plain);
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(resolve(out(r, 'checkpoint')), resolve(dir, '.cache', 'resume', `${SID}.md`));
  });
});

test('Given an armed session, When --ready then --show then --done run, Then ready is shown true and --done deletes the pace file', () => {
  withDir(shared(93, 10), (dir, run) => {
    // Given
    run('--arm', '--session', SID, '--cwd', dir);
    // When
    const ready = run('--ready', '--session', SID);
    const shown = run('--show', '--session', SID);
    const done = run('--done', '--session', SID);
    const again = run('--done', '--session', SID);
    // Then
    assert.equal(ready.status, 0, ready.stderr);
    assert.equal(shown.status, 0, shown.stderr);
    assert.equal(JSON.parse(shown.stdout).ready, true);
    assert.equal(done.status, 0, done.stderr);
    assert.equal(existsSync(paceFile(dir)), false);
    assert.equal(again.status, 0, 'a second --done is a no-op');
  });
});

test('Given an armed session that was ready, When --arm runs again on the same window, Then ready and armedAt are kept', () => {
  withDir(shared(93, 10), (dir, run) => {
    // Given
    run('--arm', '--session', SID, '--cwd', dir);
    run('--ready', '--session', SID);
    const first = JSON.parse(readFileSync(paceFile(dir), 'utf8'));
    // When
    run('--arm', '--session', SID, '--cwd', dir);
    // Then
    const got = JSON.parse(readFileSync(paceFile(dir), 'utf8'));
    assert.equal(got.ready, true);
    assert.ok(Number.isFinite(first.armedAt));
    assert.equal(got.armedAt, first.armedAt);
  });
});

test('Given files older than 7 days, When any run happens, Then old pace files and resume notes are pruned and fresh ones kept', () => {
  withDir(shared(93, 10), (dir, run) => {
    // Given
    mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
    mkdirSync(join(dir, '.cache', 'resume'), { recursive: true });
    const old = new Date(Date.now() - 8 * 86_400_000);
    const files = {
      oldPace: join(dir, '.cache', 'pace', 'old.json'), oldNote: join(dir, '.cache', 'resume', 'old.md'),
      newPace: join(dir, '.cache', 'pace', 'new.json'), newNote: join(dir, '.cache', 'resume', 'new.md'),
    };
    for (const f of Object.values(files)) writeFileSync(f, '{}');
    utimesSync(files.oldPace, old, old);
    utimesSync(files.oldNote, old, old);
    // When
    const r = run('--arm', '--session', SID, '--cwd', dir);
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(files.oldPace), false);
    assert.equal(existsSync(files.oldNote), false);
    assert.equal(existsSync(files.newPace), true);
    assert.equal(existsSync(files.newNote), true);
  });
});

test('Given bad or missing input, When the script runs, Then it exits non-zero with one line and writes no file', () => {
  withDir(shared(93, 10), (dir, run) => {
    // Given / When
    const cases = {
      noSession: run('--arm'),
      badSession: run('--arm', '--session', '../escape'),
      noMode: run('--session', SID),
      readyUnarmed: run('--ready', '--session', SID),
      showUnarmed: run('--show', '--session', SID),
    };
    // Then
    for (const [name, r] of Object.entries(cases)) {
      assert.notEqual(r.status, 0, name);
      assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, `${name}: ${r.stderr}`);
    }
    assert.equal(existsSync(join(dir, '.cache', 'pace')) ? readdirSync(join(dir, '.cache', 'pace')).length : 0, 0);
  });
});

test('Given no shared file, When --arm runs, Then it exits non-zero with one line and writes no file', () => {
  withDir(null, (dir, run) => {
    // Given / When
    const r = run('--arm', '--session', SID, '--cwd', dir);
    // Then
    assert.notEqual(r.status, 0);
    assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, r.stderr);
    assert.equal(existsSync(paceFile(dir)), false);
  });
});

test('Given a successful --arm, When it finishes, Then no temp file is left beside the pace file', () => {
  withDir(shared(93, 10), (dir, run) => {
    // Given / When
    run('--arm', '--session', SID, '--cwd', dir);
    // Then
    assert.deepEqual(readdirSync(join(dir, '.cache', 'pace')), [`${SID}.json`]);
  });
});
