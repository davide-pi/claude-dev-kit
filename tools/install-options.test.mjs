#!/usr/bin/env node
/**
 * Tests for install.ps1 -Without / -With and kit-options.json. Each test runs pwsh against a temp
 * Claude home: nothing touches the real ~/.claude. Skipped without pwsh 7.
 *
 *   node --test "tools/install-options.test.mjs"
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const INSTALL = join(dirname(fileURLToPath(import.meta.url)), '..', 'install.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
// A real install on Windows sets the User-scope CLAUDE_HOOKS to the temp home when it is unset, and the
// temp home is then deleted: skip the installing tests unless the variable is already set.
const hooksVarUnset = hasPwsh && process.platform === 'win32' &&
  !spawnSync('pwsh', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('CLAUDE_HOOKS','User')"], { encoding: 'utf8' }).stdout.trim();
const skip = !hasPwsh ? 'pwsh 7 not on PATH'
  : hooksVarUnset ? 'CLAUDE_HOOKS (User) is unset: install.ps1 would set it permanently to a temp folder'
  : false;

const home = () => mkdtempSync(join(tmpdir(), 'kit-opt-'));
const run = (dir, ...args) =>
  spawnSync('pwsh', ['-NoProfile', '-File', INSTALL, '-ClaudeHome', dir, ...args], { encoding: 'utf8', input: '' });
const options = dir => JSON.parse(readFileSync(join(dir, 'kit-options.json'), 'utf8'));
const withTmp = fn => () => { const dir = home(); try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('-Without worklog installs without the component, and -Check sees no worklog problem', { skip }, withTmp(dir => {
  const r = run(dir, '-Force', '-Without', 'worklog');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(existsSync(join(dir, 'skills', 'worklog')), false);
  assert.equal(existsSync(join(dir, 'hooks', 'worklog-pending.js')), false);
  assert.deepEqual(options(dir), { without: ['worklog'] });
  const check = run(dir, '-Check');
  assert.doesNotMatch(check.stdout, /ISSUE.*worklog/i, check.stdout);
  assert.doesNotMatch(check.stdout, /CLAUDE_WORKSPACE_ROOTS/, check.stdout);
}));

test('-With worklog brings the component back and -Check reports no worklog drift', { skip }, withTmp(dir => {
  assert.equal(run(dir, '-Force', '-Without', 'worklog').status, 0);
  const r = run(dir, '-Force', '-With', 'worklog');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(options(dir), { without: [] });
  assert.equal(existsSync(join(dir, 'skills', 'worklog', 'SKILL.md')), true);
  assert.equal(existsSync(join(dir, 'hooks', 'worklog-pending.js')), true);
  assert.doesNotMatch(run(dir, '-Check').stdout, /ISSUE.*worklog-?(pending)?(\.js)?[^\n]*(not installed|differs)/i);
}));

test('-Without on an installed copy moves it into the run backup folder', { skip }, withTmp(dir => {
  assert.equal(run(dir, '-Force').status, 0);
  assert.equal(existsSync(join(dir, 'skills', 'worklog', 'SKILL.md')), true);
  const r = run(dir, '-Force', '-Without', 'worklog');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(existsSync(join(dir, 'skills', 'worklog')), false);
  assert.equal(existsSync(join(dir, 'hooks', 'worklog-pending.js')), false);
  const [backup] = readdirSync(join(dir, 'backups')).filter(n => n.startsWith('kit-install-'));
  assert.equal(existsSync(join(dir, 'backups', backup, 'skills', 'worklog', 'SKILL.md')), true);
  assert.equal(existsSync(join(dir, 'backups', backup, 'hooks', 'worklog-pending.js')), true);
  assert.match(r.stdout, /excluded by kit-options\.json/);
}));

test('an unknown component name fails and lists the known ones', { skip }, withTmp(dir => {
  const r = run(dir, '-Without', 'nope');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /Unknown component 'nope'.*worklog/);
}));
