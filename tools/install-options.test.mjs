#!/usr/bin/env node
/**
 * Tests for install.ps1 against a temp Claude home (CLAUDE_HOOKS untouched, a leftover kit-options.json ignored). Each test runs pwsh against a temp
 * Claude home: nothing touches the real ~/.claude. Skipped without pwsh 7.
 *
 *   node --test "tools/install-options.test.mjs"
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const INSTALL = join(dirname(fileURLToPath(import.meta.url)), '..', 'install.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const skip = hasPwsh ? false : 'pwsh 7 not on PATH';

// install.ps1 must leave the User-scope CLAUDE_HOOKS alone for a non-default home. This file proves it, and
// puts the variable back if a regression sets it, so a red run never leaves a temp folder behind.
const userHooks = () => spawnSync('pwsh', ['-NoProfile', '-Command',
  "[Environment]::GetEnvironmentVariable('CLAUDE_HOOKS','User')"], { encoding: 'utf8' }).stdout.trim();
const hooksBefore = hasPwsh ? userHooks() : '';
after(() => {
  if (!hasPwsh || userHooks() === hooksBefore) return;
  spawnSync('pwsh', ['-NoProfile', '-Command',
    `[Environment]::SetEnvironmentVariable('CLAUDE_HOOKS', ${hooksBefore ? `'${hooksBefore}'` : '$null'}, 'User')`]);
});

const home = () => mkdtempSync(join(tmpdir(), 'kit-opt-'));
const run = (dir, ...args) =>
  spawnSync('pwsh', ['-NoProfile', '-File', INSTALL, '-ClaudeHome', dir, ...args], { encoding: 'utf8', input: '' });
const withTmp = fn => () => { const dir = home(); try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('given a -ClaudeHome under the temp dir, when install runs, then the User-scope CLAUDE_HOOKS is unchanged and an info line shows the set command', { skip }, withTmp(dir => {
  // Given: the variable as it is now
  const before = userHooks();

  // When
  const r = run(dir, '-Force');

  // Then
  assert.equal(userHooks(), before, r.stdout + r.stderr);
  if (!before) assert.match(r.stdout, /CLAUDE_HOOKS[^\n]*SetEnvironmentVariable\('CLAUDE_HOOKS'/, r.stdout);
}));

test('given a leftover kit-options.json naming a retired component, when install runs, then it exits 0, reports no problem and leaves the file', { skip }, withTmp(dir => {
  // Given
  const options = join(dir, 'kit-options.json');
  writeFileSync(options, '{ "without": ["worklog"] }');

  // When
  const r = run(dir, '-Force');
  const check = run(dir, '-Check');

  // Then
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + check.stdout, /kit-options/);
  assert.equal(readFileSync(options, 'utf8'), '{ "without": ["worklog"] }');
}));
