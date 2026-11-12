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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
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

test('given no cockpit file, when the status line renders, then there are no cockpit segments and the cost still shows as $0.00 when absent', () => {
  // Given / When
  const out = render(undefined, { ...SAMPLE, cost: {} });
  // Then
  assert.match(out, /\$0\.00/);
  assert.doesNotMatch(out, /\+\$|◐|⚠|☐/);
});

test('given the pane is closed, when the status line renders, then it shows the last turn cost, agents and tasks badges', () => {
  // Given / When
  const out = render({ ...STATE, open: false, at: Date.now() });
  // Then
  assert.match(out, /\+\$0\.38/);
  assert.match(out, /◐2 ⚠1/);
  assert.match(out, /☐ 3\/7/);
});

test('given the pane is open with a fresh heartbeat, when the status line renders, then it is a zero-width line', () => {
  // Given / When / Then
  assert.equal(render({ ...STATE, open: true, at: Date.now() }), '\u200B\n');
});

test('given the pane is open but stale (no heartbeat for over 90 s), when the status line renders, then it is the normal line', () => {
  // Given / When
  const out = render({ ...STATE, open: true, at: Date.now() - 120_000 });
  // Then
  assert.notEqual(out, '\u200B\n');
  assert.match(out, /\+\$0\.38/);
});

test('given a narrow terminal, when the status line renders, then trailing segments move to line 2 and nothing is cut with an ellipsis', () => {
  // Given
  const dir = mkdtempSync(join(tmpdir(), 'statusline-cockpit-'));
  try {
    mkdirSync(join(dir, '.cache'), { recursive: true });
    writeFileSync(join(dir, '.cache', `cockpit-${SAMPLE.session_id}.json`), JSON.stringify({ ...STATE, open: false, at: Date.now() }));
    // When
    const r = spawnSync(process.execPath, [STATUSLINE], {
      input: JSON.stringify(SAMPLE), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, COLUMNS: '110' },
    });
    // Then
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '');
    const [l1, l2] = out.split('\n');
    assert.doesNotMatch(out, /\u2026/);
    assert.doesNotMatch(l1, /\u2610/);
    assert.match(l2, /\u2610 3\/7/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('given Sonnet, Haiku and Opus model names, when the status line renders, then each is shown in full', () => {
  // Given / When / Then
  for (const name of ['Sonnet', 'Haiku', 'Opus']) {
    assert.match(render(undefined, { ...SAMPLE, model: { display_name: `Claude ${name} 4.5 (1M context)` } }), new RegExp(`${name} 4\\.5`));
  }
});

// ── Folder icon ──────────────────────────────────────────────────────────────

test('given a linked worktree and a main checkout, when the status line renders, then both show the folder icon (U+F024B)', () => {
  // Given
  const base = mkdtempSync(join(tmpdir(), 'statusline-worktree-'));
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci', ...args], { cwd, stdio: 'ignore' });
  try {
    const main = join(base, 'main');
    const linked = join(base, 'linked');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(main, 'worktree', 'add', '-q', linked, '-b', 'linked-branch');
    // When
    const inWorktree = render(undefined, { ...SAMPLE, cwd: linked });
    // Then
    assert.ok(inWorktree.includes('\u{F024B}'), 'folder icon in the worktree');
    assert.ok(!inWorktree.includes('\u{F0CD0}'), 'no worktree icon');
    assert.ok(inWorktree.includes('linked'), 'the worktree root still names the segment');
    const inMain = render(undefined, { ...SAMPLE, cwd: main });
    assert.ok(inMain.includes('\u{F024B}'), 'folder icon');
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

test('given cache files of each kind old and fresh, when the status line runs, then old files go and fresh ones, the current session and foreign files stay', () => {
  withCache((dir, has) => {
    // Given
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
    // When
    run(dir);
    // Then
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

test('given session data files with and without a transcript, when the status line runs, then it is kept while its transcript exists and deleted once it is gone', () => {
  withCache((dir, has) => {
    // Given
    const sid = SAMPLE.session_id;
    transcript(dir, 'p1', 'alive');
    transcript(dir, 'p2', 'alive-too');
    put(dir, 'cockpit-data-alive.json', 40 * 24 * HOUR);
    put(dir, 'cockpit-data-alive-too.json', 40 * 24 * HOUR);
    put(dir, 'cockpit-data-gone.json', 1 * HOUR);
    put(dir, `cockpit-data-${sid}.json`, 40 * 24 * HOUR); // the current session's: never touched, transcript or not
    put(dir, 'cockpit-old.json', 4 * 24 * HOUR);
    // When
    run(dir);
    // Then
    assert.equal(has('cockpit-data-alive.json'), true, 'transcript in one project');
    assert.equal(has('cockpit-data-alive-too.json'), true, 'transcript in another project');
    assert.equal(has(`cockpit-data-${sid}.json`), true, 'current session');
    assert.equal(has('cockpit-data-gone.json'), false, 'no transcript left');
    assert.equal(has('cockpit-old.json'), false, 'the handshake file still ages out after 3 days');
  });
});

test('given no readable projects folder, when the status line runs, then no data file is deleted', () => {
  withCache((dir, has) => {
    // Given
    put(dir, 'cockpit-data-orphan.json', 40 * 24 * HOUR);
    // When
    run(dir);
    // Then
    assert.equal(has('cockpit-data-orphan.json'), true);
  });
});

test('given a prune pass that just ran, when the status line runs again within the hour, then the marker file throttles it and an older marker allows a new pass', () => {
  withCache((dir, has) => {
    // Given
    run(dir);
    put(dir, 'context-old.json', 7 * HOUR);
    // When
    run(dir);
    // Then
    assert.equal(has('context-old.json'), true, 'second run within the hour must not prune');
    put(dir, '.statusline-prune', 2 * HOUR);
    run(dir);
    assert.equal(has('context-old.json'), false, 'a marker older than an hour allows a new pass');
  });
});

test('given a marker dated in the future, when the status line runs, then pruning is not blocked', () => {
  withCache((dir, has) => {
    // Given
    put(dir, '.statusline-prune', -5 * HOUR);
    put(dir, 'context-old.json', 7 * HOUR);
    // When
    run(dir);
    // Then
    assert.equal(has('context-old.json'), false);
  });
});

// ── Cache hit of the last turn ───────────────────────────────────────────────

/** The raw output (colours kept) of a render with `current_usage` in the context window; undefined: no usage. */
function renderUsage(usage) {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-hit-'));
  try {
    const payload = { ...SAMPLE, context_window: { ...SAMPLE.context_window, ...(usage === undefined ? {} : { current_usage: usage }) } };
    const r = spawnSync(process.execPath, [STATUSLINE], {
      input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, COLUMNS: '200' },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const plain = (s) => s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '');
const GREEN = '\x1b[38;2;126;198;153m', AMBER = '\x1b[38;2;232;163;90m', RED = '\x1b[38;2;240;122;111m';

test('given the last turn usage of cache read, creation and input tokens, when the status line renders, then the cache hit shows right of the context readout, coloured by band', () => {
  // Given
  // 90 / (90 + 5 + 5) = 90 % green; 60 / 100 = 60 % amber; 10 / 100 = 10 % red
  for (const [read, creation, input, pct, col] of [[90, 5, 5, 90, GREEN], [60, 30, 10, 60, AMBER], [10, 80, 10, 10, RED], [80, 10, 10, 80, GREEN], [50, 40, 10, 50, AMBER]]) {
    // When / Then
    const raw = renderUsage({ cache_read_input_tokens: read, cache_creation_input_tokens: creation, input_tokens: input, output_tokens: 7 });
    assert.ok(plain(raw).includes("(248K/1M) \u{F09D1} " + pct + "%"), plain(raw));
    assert.ok(raw.includes(`${col}\u{F09D1} ${pct}%`), `${pct} % is coloured ${col}`);
  }
});

test('given no usage, a null usage, a zero total or a bad number, when the status line renders, then the cache hit is absent', () => {
  // Given / When / Then
  for (const usage of [undefined, null, {}, { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, input_tokens: 0 }, { cache_read_input_tokens: 'x', input_tokens: 5 }]) {
    assert.doesNotMatch(plain(renderUsage(usage)), /\u{F09D1}/u);
  }
  // a provider that reports no cache tokens but plain input: 0 % is a reading, not an absence
  assert.match(plain(renderUsage({ input_tokens: 100 })), /\u{F09D1} 0%/u);
});

/** Renders with a pre-written git cache entry of `ageMs` for a directory that is no repository: the branch shows only when the entry is reused. */
function renderWithGitCache(name, value, ageMs) {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-git-'));
  try {
    const cwd = join(dir, 'not-a-repo');
    mkdirSync(join(dir, '.cache'), { recursive: true });
    mkdirSync(cwd);
    const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 16);
    writeFileSync(join(dir, '.cache', `${name}-${hash}.json`), JSON.stringify({ at: Date.now() - ageMs, value }));
    const r = spawnSync(process.execPath, [STATUSLINE], {
      input: JSON.stringify({ ...SAMPLE, cwd }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, COLUMNS: '200' },
    });
    assert.equal(r.status, 0, r.stderr);
    return plain(r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('given a git cache entry of 12 s and one of 31 s, when the status line renders, then the branch outlives several 5 s renders and expires after 30 s', () => {
  // Given
  const git = { branch: 'cached-branch', remote: null, staged: 0, modified: 0, untracked: 0 };
  // When / Then
  assert.match(renderWithGitCache('git', git, 12_000), /cached-branch/, 'a 12 s old entry is reused');
  assert.doesNotMatch(renderWithGitCache('git', git, 31_000), /cached-branch/, 'a 31 s old entry is recomputed');
});

test('given a worktree cache entry of 5 minutes, when the status line renders, then the linked-worktree root is kept', () => {
  // Given / When / Then
  assert.match(renderWithGitCache('worktree', { root: 'C:/wt/cached-tree' }, 5 * 60_000), /cached-tree/);
});

test('given a .git/config and a linked worktree, when the remote URL is read, then it comes from .git/config also in the worktree and is null without origin', () => {
  // Given
  const { remoteUrl } = createRequire(import.meta.url)('../hooks/lib/git-dir.js');
  const dir = mkdtempSync(join(tmpdir(), 'statusline-remote-'));
  try {
    const main = join(dir, '.git');
    mkdirSync(join(main, 'worktrees', 'wt'), { recursive: true });
    writeFileSync(join(main, 'config'), '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://x/other.git\n[remote "origin"]\n\turl = https://dev.azure.com/o/p/_git/r\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n');
    writeFileSync(join(main, 'worktrees', 'wt', 'commondir'), '../..\n');
    // When / Then
    assert.equal(remoteUrl(main), 'https://dev.azure.com/o/p/_git/r');
    assert.equal(remoteUrl(join(main, 'worktrees', 'wt')), 'https://dev.azure.com/o/p/_git/r');
    writeFileSync(join(main, 'config'), '[core]\n\tbare = false\n');
    assert.equal(remoteUrl(main), null, 'no origin');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('given the statusline sources, when they are searched for a remote lookup, then git is asked for the status only, never for the remote', () => {
  // Given
  const modules = readdirSync(join(ROOT, 'statusline')).map((f) => readFileSync(join(ROOT, 'statusline', f), 'utf8'));
  // When / Then
  assert.doesNotMatch([readFileSync(STATUSLINE, 'utf8'), ...modules].join('\n'), /["']remote["']\s*,\s*["']get-url["']/);
});
