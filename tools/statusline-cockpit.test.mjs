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
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
