#!/usr/bin/env node
/**
 * Tests for install.ps1 -Without / -With and kit-options.json. Each test runs pwsh against a temp
 * Claude home: nothing touches the real ~/.claude. Skipped without pwsh 7.
 *
 *   node --test "tools/install-options.test.mjs"
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
const options = dir => JSON.parse(readFileSync(join(dir, 'kit-options.json'), 'utf8'));
const withTmp = fn => () => { const dir = home(); try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('given an empty home, when install runs with -Without worklog, then it installs without the component and -Check sees no worklog problem', { skip }, withTmp(dir => {
  // Given / When
  const r = run(dir, '-Force', '-Without', 'worklog');

  // Then
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(existsSync(join(dir, 'skills', 'worklog')), false);
  assert.equal(existsSync(join(dir, 'hooks', 'worklog-pending.js')), false);
  assert.deepEqual(options(dir), { without: ['worklog'] });
  const check = run(dir, '-Check');
  assert.doesNotMatch(check.stdout, /ISSUE.*worklog/i, check.stdout);
  assert.doesNotMatch(check.stdout, /CLAUDE_WORKSPACE_ROOTS/, check.stdout);
}));

test('given an install without worklog, when install runs with -With worklog, then the component is back and -Check reports no worklog drift', { skip }, withTmp(dir => {
  // Given
  assert.equal(run(dir, '-Force', '-Without', 'worklog').status, 0);

  // When
  const r = run(dir, '-Force', '-With', 'worklog');

  // Then
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(options(dir), { without: [] });
  assert.equal(existsSync(join(dir, 'skills', 'worklog', 'SKILL.md')), true);
  assert.equal(existsSync(join(dir, 'hooks', 'worklog-pending.js')), true);
  assert.doesNotMatch(run(dir, '-Check').stdout, /ISSUE.*worklog-?(pending)?(\.js)?[^\n]*(not installed|differs)/i);
}));

test('given an installed copy, when install runs with -Without worklog, then it moves the component into the run backup folder', { skip }, withTmp(dir => {
  // Given
  assert.equal(run(dir, '-Force').status, 0);
  assert.equal(existsSync(join(dir, 'skills', 'worklog', 'SKILL.md')), true);

  // When
  const r = run(dir, '-Force', '-Without', 'worklog');

  // Then
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(existsSync(join(dir, 'skills', 'worklog')), false);
  assert.equal(existsSync(join(dir, 'hooks', 'worklog-pending.js')), false);
  const [backup] = readdirSync(join(dir, 'backups')).filter(n => n.startsWith('kit-install-'));
  assert.equal(existsSync(join(dir, 'backups', backup, 'skills', 'worklog', 'SKILL.md')), true);
  assert.equal(existsSync(join(dir, 'backups', backup, 'hooks', 'worklog-pending.js')), true);
  assert.match(r.stdout, /excluded by kit-options\.json/);
}));

test('given a -ClaudeHome under the temp dir, when install runs, then the User-scope CLAUDE_HOOKS is unchanged and an info line shows the set command', { skip }, withTmp(dir => {
  // Given: the variable as it is now
  const before = userHooks();

  // When
  const r = run(dir, '-Force');

  // Then
  assert.equal(userHooks(), before, r.stdout + r.stderr);
  if (!before) assert.match(r.stdout, /CLAUDE_HOOKS[^\n]*SetEnvironmentVariable\('CLAUDE_HOOKS'/, r.stdout);
}));

test('given a kit-options.json that cannot be read, when install runs without -Check, then it exits 1 and names the problem', { skip }, withTmp(dir => {
  // Given
  writeFileSync(join(dir, 'kit-options.json'), '{ not json');

  // When
  const r = run(dir, '-Force');

  // Then
  assert.match(r.stdout, /kit-options\.json cannot be read/);
  assert.equal(r.status, 1, r.stdout + r.stderr);
}));

test('given an unknown component name, when install runs with -Without, then it fails and lists the known ones', { skip }, withTmp(dir => {
  // Given / When
  const r = run(dir, '-Without', 'nope');

  // Then
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /Unknown component 'nope'.*worklog/);
}));
