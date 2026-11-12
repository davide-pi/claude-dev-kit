#!/usr/bin/env node
/**
 * Tests for statusline/pace.js (the shared usage-pace file) and its one call in statusline.js.
 * Zero dependencies, `node:test` on Node 18+.
 *
 *   node --test "tools/*.test.mjs"
 *
 * Contract used here: recordPace(rl, nowMs, writer) writes <CLAUDE_CONFIG_DIR>/.usage-pace.json (the directory is
 * read at call time), readPace() returns the parsed file, the last good one of that file on a torn read, or null;
 * paceView(pace, nowMs) returns { five_hour, seven_day } each { pct, band, resetsAt, burn, etaAt }.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pace = require(join(ROOT, 'statusline', 'pace.js'));
const SAMPLE = JSON.parse(readFileSync(join(ROOT, 'mods', 'cockpit', 'statusline', 'sample.json'), 'utf8'));

const MIN = 60_000;
const T0 = 1_800_000_000_000;
const R5 = T0 + 3 * 3600_000;
const R7 = T0 + 3 * 86_400_000;
const rl = (p5, p7, r5 = R5, r7 = R7) => ({
  five_hour: { used_percentage: p5, resets_at: r5 / 1000 },
  seven_day: { used_percentage: p7, resets_at: r7 / 1000 },
});

/** Runs fn with its own CLAUDE_CONFIG_DIR; `file` is the shared file inside it. */
function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'usage-pace-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try { return fn(dir, join(dir, '.usage-pace.json')); } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    rmSync(dir, { recursive: true, force: true });
  }
}
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('Given a status line payload, When recordPace runs, Then the file holds the schema with resets in ms', () => inDir((dir, file) => {
  // Given
  const payload = rl(41.5, 12.2);
  // When
  pace.recordPace(payload, T0, 'statusline');
  // Then
  const got = read(file);
  assert.equal(got.v, 1);
  assert.equal(got.updatedAt, T0);
  assert.equal(got.writer, 'statusline');
  assert.deepEqual(got.five_hour, { pct: 41.5, resetsAt: R5 });
  assert.deepEqual(got.seven_day, { pct: 12.2, resetsAt: R7 });
  assert.deepEqual(got.samples5h, [{ t: T0, pct: 41.5 }]);
  assert.deepEqual(got.samples7d, [{ t: T0, pct: 12.2 }]);
}));

test('Given a sample 30 s ago, When recordPace runs again, Then no new sample is added; at 60 s it is', () => inDir((dir, file) => {
  // Given
  pace.recordPace(rl(10, 5), T0, 'statusline');
  // When
  pace.recordPace(rl(10.1, 5), T0 + 30_000, 'statusline');
  const after30 = read(file).samples5h.length;
  pace.recordPace(rl(10.2, 5), T0 + 60_000, 'statusline');
  // Then
  assert.equal(after30, 1);
  assert.deepEqual(read(file).samples5h.map((s) => s.t), [T0, T0 + 60_000]);
}));

test('Given 70 minutes of samples, When recordPace runs, Then only the last 60 are kept', () => inDir((dir, file) => {
  // Given / When
  for (let i = 0; i < 70; i++) pace.recordPace(rl(10 + i * 0.1, 5), T0 + i * MIN, 'statusline');
  // Then
  const s = read(file).samples5h;
  assert.equal(s.length, 60);
  assert.equal(s[0].t, T0 + 10 * MIN);
  assert.equal(s.at(-1).t, T0 + 69 * MIN);
}));

test('Given the 5h window resets, When recordPace runs, Then samples5h restarts and samples7d is kept', () => inDir((dir, file) => {
  // Given
  pace.recordPace(rl(90, 40), T0, 'statusline');
  pace.recordPace(rl(91, 41), T0 + MIN, 'statusline');
  // When
  const newR5 = R5 + 5 * 3600_000;
  pace.recordPace(rl(2, 42, newR5, R7), R5 + MIN, 'statusline');
  // Then
  const got = read(file);
  assert.deepEqual(got.five_hour, { pct: 2, resetsAt: newR5 });
  assert.deepEqual(got.samples5h, [{ t: R5 + MIN, pct: 2 }]);
  assert.equal(got.samples7d.length, 3);
}));

test('Given a stored 50%, When a lower pct for the same reset arrives, Then the stored value stays', () => inDir((dir, file) => {
  // Given
  pace.recordPace(rl(50, 20), T0, 'statusline');
  // When
  pace.recordPace(rl(47, 19), T0 + 2 * MIN, 'statusline');
  // Then
  const got = read(file);
  assert.equal(got.five_hour.pct, 50);
  assert.equal(got.seven_day.pct, 20);
}));

test('Given a stored 50%, When an equal or higher pct for the same reset arrives, Then it is accepted', () => inDir((dir, file) => {
  // Given
  pace.recordPace(rl(50, 20), T0, 'statusline');
  // When
  pace.recordPace(rl(52, 20), T0 + 2 * MIN, 'statusline');
  // Then
  assert.equal(read(file).five_hour.pct, 52);
}));

test('Given a file with a field the cockpit wrote, When recordPace runs, Then the field is kept', () => inDir((dir, file) => {
  // Given
  writeFileSync(file, JSON.stringify({ v: 1, cockpit: { tick: 7 }, five_hour: { pct: 1, resetsAt: R5 }, seven_day: { pct: 1, resetsAt: R7 }, samples5h: [], samples7d: [] }));
  // When
  pace.recordPace(rl(3, 3), T0, 'statusline');
  // Then
  assert.deepEqual(read(file).cockpit, { tick: 7 });
}));

test('Given a write, When it finishes, Then only the shared file is left in the directory (no temp file)', () => inDir((dir) => {
  // Given / When
  pace.recordPace(rl(10, 5), T0, 'statusline');
  // Then
  assert.deepEqual(readdirSync(dir), ['.usage-pace.json']);
}));

test('Given a torn file after a good read, When readPace runs, Then it returns the last good value and never throws', () => inDir((dir, file) => {
  // Given
  pace.recordPace(rl(33, 7), T0, 'statusline');
  const good = pace.readPace();
  writeFileSync(file, '{"v":1,"five_hour":{"pct":3');
  // When
  const got = pace.readPace();
  // Then
  assert.equal(good.five_hour.pct, 33);
  assert.deepEqual(got, good);
}));

test('Given a torn file never read before, When readPace runs, Then it returns null', () => {
  // Given
  const dir = mkdtempSync(join(tmpdir(), 'usage-pace-'));
  writeFileSync(join(dir, '.usage-pace.json'), '{"v":1,');
  try {
    // When
    const r = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(join(ROOT, 'statusline', 'pace.js'))}).readPace()))`], {
      encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    });
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'null');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Given a torn shared file (a writer mid-write), When recordPace runs in a fresh process, Then it skips the write and keeps the file', () => {
  // Given
  const dir = mkdtempSync(join(tmpdir(), 'usage-pace-'));
  const file = join(dir, '.usage-pace.json');
  writeFileSync(file, '{"v":1,"samples5h":[{"t":1');
  try {
    // When
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(join(ROOT, 'statusline', 'pace.js'))}).recordPace(${JSON.stringify(rl(40, 10))}, ${T0}, 'statusline')`], {
      encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    });
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(file, 'utf8'), '{"v":1,"samples5h":[{"t":1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Given an unchanged reading 20 s after the last write, When recordPace runs, Then the file is not rewritten; after 60 s it is', () => inDir((dir, file) => {
  // Given
  pace.recordPace(rl(40, 10), T0, 'statusline');
  // When
  pace.recordPace(rl(40, 10), T0 + 20_000, 'statusline');
  const early = read(file).updatedAt;
  pace.recordPace(rl(40, 10), T0 + 61_000, 'statusline');
  // Then
  assert.equal(early, T0);
  assert.equal(read(file).updatedAt, T0 + 61_000);
}));

test('Given a burn that reaches 98% only after the reset, When paceView runs, Then the ETA is null', () => {
  // Given: +1% every 3 min = 20 %/h at 12%, reset in 1 hour (98% would take 4.3 h)
  const p = {
    five_hour: { pct: 12, resetsAt: T0 + 6 * MIN + 3600_000 }, seven_day: { pct: 1, resetsAt: R7 },
    samples5h: [{ t: T0, pct: 10 }, { t: T0 + 3 * MIN, pct: 11 }, { t: T0 + 6 * MIN, pct: 12 }], samples7d: [],
  };
  // When
  const v = pace.paceView(p, T0 + 6 * MIN).five_hour;
  // Then
  assert.ok(v.burn > 0);
  assert.equal(v.etaAt, null);
});

test('Given each threshold, When paceView runs, Then the band is 0/70/85/92/96/98', () => {
  const bandOf = (pct) => pace.paceView({
    five_hour: { pct, resetsAt: R5 }, seven_day: { pct: 0, resetsAt: R7 }, samples5h: [], samples7d: [],
  }, T0).five_hour.band;
  // Given / When / Then
  assert.deepEqual([0, 69.9, 70, 84.9, 85, 91.9, 92, 95.9, 96, 97.9, 98, 100].map(bandOf),
    [0, 0, 70, 70, 85, 85, 92, 92, 96, 96, 98, 98]);
});

test('Given a window past its reset, When paceView runs, Then it reads 0 and the other window is unaffected', () => {
  // Given
  const p = { five_hour: { pct: 97, resetsAt: T0 - MIN }, seven_day: { pct: 86, resetsAt: R7 }, samples5h: [], samples7d: [] };
  // When
  const v = pace.paceView(p, T0);
  // Then
  assert.equal(v.five_hour.pct, 0);
  assert.equal(v.five_hour.band, 0);
  assert.equal(v.seven_day.band, 85);
});

test('Given 3 samples over 6 min, When paceView runs, Then burn is %/h and ETA reaches 98%', () => {
  // Given: +1% every 3 min = 20 %/h, now at 12%, reset in 5 h (98% comes first, in 4.3 h)
  const p = {
    five_hour: { pct: 12, resetsAt: T0 + 5 * 3600_000 }, seven_day: { pct: 1, resetsAt: R7 },
    samples5h: [{ t: T0, pct: 10 }, { t: T0 + 3 * MIN, pct: 11 }, { t: T0 + 6 * MIN, pct: 12 }], samples7d: [],
  };
  // When
  const v = pace.paceView(p, T0 + 6 * MIN).five_hour;
  // Then
  assert.ok(Math.abs(v.burn - 20) < 0.01, `burn ${v.burn}`);
  assert.ok(Math.abs(v.etaAt - (T0 + 6 * MIN + (98 - 12) / 20 * 3600_000)) < 1000, `eta ${v.etaAt}`);
});

test('Given 2 samples, or 3 samples over under 5 min, When paceView runs, Then burn and ETA are null', () => {
  const view = (samples5h) => pace.paceView({
    five_hour: { pct: 12, resetsAt: R5 }, seven_day: { pct: 1, resetsAt: R7 }, samples5h, samples7d: [],
  }, T0 + 10 * MIN).five_hour;
  // Given / When
  const two = view([{ t: T0, pct: 10 }, { t: T0 + 6 * MIN, pct: 12 }]);
  const short = view([{ t: T0, pct: 10 }, { t: T0 + 2 * MIN, pct: 11 }, { t: T0 + 4 * MIN, pct: 12 }]);
  // Then
  assert.equal(two.burn, null);
  assert.equal(two.etaAt, null);
  assert.equal(short.burn, null);
  assert.equal(short.etaAt, null);
});

/** Renders statusline.js with the cockpit pane open; pacePath lets a case plant a directory where the file goes. */
function renderOpen(dir, payload) {
  mkdirSync(join(dir, '.cache'), { recursive: true });
  writeFileSync(join(dir, '.cache', `cockpit-${payload.session_id}.json`), JSON.stringify({ open: true, at: Date.now() }));
  return spawnSync(process.execPath, [join(ROOT, 'statusline.js')], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, COLUMNS: '200' },
  });
}

test('Given the cockpit pane is open, When the status line renders, Then the shared file is written and the line stays silent', () => {
  // Given
  const dir = mkdtempSync(join(tmpdir(), 'usage-pace-'));
  const payload = { ...SAMPLE, rate_limits: {
    five_hour: { used_percentage: 38, resets_at: Math.floor(Date.now() / 1000) + 7200 },
    seven_day: { used_percentage: 59, resets_at: Math.floor(Date.now() / 1000) + 3 * 86400 },
  } };
  try {
    // When
    const r = renderOpen(dir, payload);
    // Then
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '​\n');
    const got = read(join(dir, '.usage-pace.json'));
    assert.equal(got.five_hour.pct, 38);
    assert.equal(got.seven_day.pct, 59);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Given recordPace cannot write, When the status line renders, Then the output is unchanged and the exit is 0', () => {
  // Given: a directory sits where the shared file goes, so the rename fails
  const good = mkdtempSync(join(tmpdir(), 'usage-pace-'));
  const bad = mkdtempSync(join(tmpdir(), 'usage-pace-'));
  mkdirSync(join(bad, '.usage-pace.json'));
  const payload = { ...SAMPLE, rate_limits: {
    five_hour: { used_percentage: 38, resets_at: Math.floor(Date.now() / 1000) + 7200 },
    seven_day: { used_percentage: 59, resets_at: Math.floor(Date.now() / 1000) + 3 * 86400 },
  } };
  const render = (dir) => spawnSync(process.execPath, [join(ROOT, 'statusline.js')], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, COLUMNS: '200' },
  });
  try {
    // When
    const a = render(good);
    const b = render(bad);
    // Then
    assert.equal(b.status, 0, b.stderr);
    assert.equal(b.stdout, a.stdout);
    assert.ok(existsSync(join(good, '.usage-pace.json')));
  } finally { rmSync(good, { recursive: true, force: true }); rmSync(bad, { recursive: true, force: true }); }
});
