#!/usr/bin/env node
/**
 * Tests for statusline.js and the optional cockpit state file (mods/cockpit writes
 * ~/.claude/.cache/cockpit-<session>.json). Zero dependencies — `node:test` on Node 18+.
 *
 *   node --test "tools/*.test.mjs"
 *
 * Each case gets its own CLAUDE_CONFIG_DIR, so nothing outside a temp directory is touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATUSLINE = join(ROOT, 'statusline.js');
const SAMPLE = JSON.parse(readFileSync(join(ROOT, 'mods', 'cockpit', 'statusline', 'sample.json'), 'utf8'));
const NOW = Math.floor(Date.now() / 1000);
SAMPLE.rate_limits.five_hour.resets_at = NOW + 2 * 3600;
SAMPLE.rate_limits.seven_day.resets_at = NOW + 3 * 86400;

const STATE = { lastTurnUsd: 0.38, agents: { running: 2, modelWarnings: 1 }, tasks: { done: 3, total: 7 } };

/** Renders the status line with the given cockpit state (undefined: no file) and returns the plain text. */
function render(state, payload = SAMPLE) {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-cockpit-'));
  try {
    if (state !== undefined) {
      mkdirSync(join(dir, '.cache'), { recursive: true });
      writeFileSync(join(dir, '.cache', `cockpit-${payload.session_id}.json`), JSON.stringify(state));
    }
    const r = spawnSync(process.execPath, [STATUSLINE], {
      input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, COLUMNS: '200' },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('no cockpit file: no cockpit segments, the cost still shows as $0.00 when absent', () => {
  const out = render(undefined, { ...SAMPLE, cost: {} });
  assert.match(out, /\$0\.00/);
  assert.doesNotMatch(out, /\+\$|◐|⚠|☐/);
});

test('pane closed: last turn cost, agents and tasks badges', () => {
  const out = render({ ...STATE, open: false, at: Date.now() });
  assert.match(out, /\+\$0\.38/);
  assert.match(out, /◐2 ⚠1/);
  assert.match(out, /☐ 3\/7/);
});

test('pane open with a fresh heartbeat: a zero-width line', () => {
  assert.equal(render({ ...STATE, open: true, at: Date.now() }), '\u200B\n');
});

test('pane open but stale (no heartbeat for over 45 s): the normal line', () => {
  const out = render({ ...STATE, open: true, at: Date.now() - 60_000 });
  assert.notEqual(out, '\u200B\n');
  assert.match(out, /\+\$0\.38/);
});

// ── Folder icon ──────────────────────────────────────────────────────────────

test('folder segment: a linked worktree shows nf-md-source_repository_multiple (U+F0CD0), a main checkout the folder icon', () => {
  const base = mkdtempSync(join(tmpdir(), 'statusline-worktree-'));
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci', ...args], { cwd, stdio: 'ignore' });
  try {
    const main = join(base, 'main');
    const linked = join(base, 'linked');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(main, 'worktree', 'add', '-q', linked, '-b', 'linked-branch');
    const inWorktree = render(undefined, { ...SAMPLE, cwd: linked });
    assert.ok(inWorktree.includes('\u{F0CD0}'), 'worktree icon');
    assert.ok(!inWorktree.includes('\u{F0253}'), 'the old worktree icon is gone');
    const inMain = render(undefined, { ...SAMPLE, cwd: main });
    assert.ok(inMain.includes('\u{F024B}'), 'folder icon');
    assert.ok(!inMain.includes('\u{F0CD0}'), 'no worktree icon in the main checkout');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// ── Cache pruning ────────────────────────────────────────────────────────────

const HOUR = 3600_000;
const HEX = 'a'.repeat(16);

/** Runs the status line once in `dir` (a CLAUDE_CONFIG_DIR) with the sample payload. */
function run(dir, payload = SAMPLE) {
  const r = spawnSync(process.execPath, [STATUSLINE], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, COLUMNS: '200' },
  });
  assert.equal(r.status, 0, r.stderr);
}

/** Writes `name` in the cache folder, `ageMs` old. */
function put(dir, name, ageMs) {
  const file = join(dir, '.cache', name);
  writeFileSync(file, '{}');
  const t = (Date.now() - ageMs) / 1000;
  utimesSync(file, t, t);
}

function withCache(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-prune-'));
  mkdirSync(join(dir, '.cache'), { recursive: true });
  try { fn(dir, (name) => existsSync(join(dir, '.cache', name))); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('prune: old files of each kind go, fresh ones stay, the current session and foreign files are untouched', () => {
  withCache((dir, has) => {
    const sid = SAMPLE.session_id;
    put(dir, `git-${HEX}.json`, 2 * HOUR);
    put(dir, `worktree-${HEX}.json`, 2 * HOUR);
    put(dir, 'context-old.json', 7 * HOUR);
    put(dir, 'cockpit-old.json', 4 * 24 * HOUR);
    put(dir, `git-${'b'.repeat(16)}.json`, 10 * 60_000);
    put(dir, 'context-fresh.json', 5 * HOUR);
    put(dir, 'cockpit-fresh.json', 2 * 24 * HOUR);
    put(dir, `context-${sid}.json`, 30 * HOUR);
    put(dir, `cockpit-${sid}.json`, 30 * HOUR);
    put(dir, 'nudge-x.json', 30 * HOUR);
    put(dir, 'a.log', 30 * HOUR);
    run(dir);
    for (const gone of [`git-${HEX}.json`, `worktree-${HEX}.json`, 'context-old.json', 'cockpit-old.json']) assert.equal(has(gone), false, gone);
    for (const kept of [`git-${'b'.repeat(16)}.json`, 'context-fresh.json', 'cockpit-fresh.json', `cockpit-${sid}.json`, 'nudge-x.json', 'a.log']) assert.equal(has(kept), true, kept);
    assert.equal(has('.statusline-prune'), true);
  });
});

/** Writes `<projects>/<project>/<session>.jsonl`: the transcript the session data file lives by. */
function transcript(dir, project, session) {
  mkdirSync(join(dir, 'projects', project), { recursive: true });
  writeFileSync(join(dir, 'projects', project, `${session}.jsonl`), '');
}

test('prune: the session data file is not a 3-day handshake file: kept while its transcript exists, deleted once it is gone', () => {
  withCache((dir, has) => {
    const sid = SAMPLE.session_id;
    transcript(dir, 'p1', 'alive');
    transcript(dir, 'p2', 'alive-too');
    put(dir, 'cockpit-data-alive.json', 40 * 24 * HOUR);
    put(dir, 'cockpit-data-alive-too.json', 40 * 24 * HOUR);
    put(dir, 'cockpit-data-gone.json', 1 * HOUR);
    put(dir, `cockpit-data-${sid}.json`, 40 * 24 * HOUR); // the current session's: never touched, transcript or not
    put(dir, 'cockpit-old.json', 4 * 24 * HOUR);
    run(dir);
    assert.equal(has('cockpit-data-alive.json'), true, 'transcript in one project');
    assert.equal(has('cockpit-data-alive-too.json'), true, 'transcript in another project');
    assert.equal(has(`cockpit-data-${sid}.json`), true, 'current session');
    assert.equal(has('cockpit-data-gone.json'), false, 'no transcript left');
    assert.equal(has('cockpit-old.json'), false, 'the handshake file still ages out after 3 days');
  });
});

test('prune: with no readable projects folder no data file is deleted', () => {
  withCache((dir, has) => {
    put(dir, 'cockpit-data-orphan.json', 40 * 24 * HOUR);
    run(dir);
    assert.equal(has('cockpit-data-orphan.json'), true);
  });
});

test('prune: throttled to once an hour by the marker file', () => {
  withCache((dir, has) => {
    run(dir);
    put(dir, 'context-old.json', 7 * HOUR);
    run(dir);
    assert.equal(has('context-old.json'), true, 'second run within the hour must not prune');
    put(dir, '.statusline-prune', 2 * HOUR);
    run(dir);
    assert.equal(has('context-old.json'), false, 'a marker older than an hour allows a new pass');
  });
});

test('prune: a marker dated in the future does not block pruning', () => {
  withCache((dir, has) => {
    put(dir, '.statusline-prune', -5 * HOUR);
    put(dir, 'context-old.json', 7 * HOUR);
    run(dir);
    assert.equal(has('context-old.json'), false);
  });
});
