#!/usr/bin/env node
/**
 * Tests for install.ps1 -Pull. Each test copies install.ps1 and install/ into a throwaway git repo and
 * pulls from a temp Claude home: nothing touches the real ~/.claude or this checkout. Skipped without pwsh 7 or git.
 *
 *   node --test "tools/install-pull.test.mjs"
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ok = cmd => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const skip = hasPwsh && ok('git') ? false : 'pwsh 7 or git not on PATH';

const git = (repo, ...args) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8' });
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };

// A committed fake repo (rules/a.md, CLAUDE.md, settings.json) next to a fake live home holding different content.
const withFixture = fn => () => {
  const base = mkdtempSync(join(tmpdir(), 'kit-pull-'));
  const repo = join(base, 'repo');
  const live = join(base, 'home');
  try {
    mkdirSync(repo); mkdirSync(live);
    cpSync(join(KIT, 'install.ps1'), join(repo, 'install.ps1'));
    cpSync(join(KIT, 'install'), join(repo, 'install'), { recursive: true });
    for (const root of [repo, live]) {
      put(root, 'rules/a.md', root === repo ? 'repo rule\n' : 'live rule\n');
      put(root, 'CLAUDE.md', root === repo ? 'repo claude\n' : 'live claude\n');
      put(root, 'settings.json', root === repo ? '{"a":1}\n' : '{"a":2}\n');
    }
    git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'init');
    fn({ repo, live, pull: (env = {}) => spawnSync('pwsh', ['-NoProfile', '-File', join(repo, 'install.ps1'), '-Pull', '-ClaudeHome', live], { encoding: 'utf8', input: '', env: { ...process.env, ...env } }) });
  } finally { rmSync(base, { recursive: true, force: true }); }
};
const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

test('given an uncommitted repo file and a different live file, when -Pull runs, then the repo file is kept and the skip is reported', { skip }, withFixture(({ repo, pull }) => {
  // Given
  put(repo, 'rules/a.md', 'my unsaved work\n');

  // When
  const r = pull();

  // Then
  assert.equal(read(repo, 'rules/a.md'), 'my unsaved work\n', r.stdout + r.stderr);
  assert.match(r.stdout, /rules\/a\.md skipped: the repo copy has uncommitted changes.{1,3}commit or stash/);
  assert.match(r.stdout, /3 file\(s\) skipped by -Pull/);
}));

test('given a committed repo file and a different live file, when -Pull runs, then the live content is pulled', { skip }, withFixture(({ repo, pull }) => {
  // Given / When
  const r = pull();

  // Then
  assert.equal(read(repo, 'rules/a.md'), 'live rule\n', r.stdout + r.stderr);
  assert.match(r.stdout, /rules\/a\.md pulled into the repo/);
}));

test('given a differing live settings.json and no overlay, when -Pull runs, then the repo settings.json is kept and the skip is reported', { skip }, withFixture(({ repo, pull }) => {
  // Given / When
  const r = pull();

  // Then
  assert.equal(read(repo, 'settings.json'), '{"a":1}\n', r.stdout + r.stderr);
  assert.match(r.stdout, /settings\.json skipped: personalised, never pulled/);
}));

test('given a differing live CLAUDE.md, when -Pull runs, then the repo CLAUDE.md is kept and the skip is reported', { skip }, withFixture(({ repo, pull }) => {
  // Given / When
  const r = pull();

  // Then
  assert.equal(read(repo, 'CLAUDE.md'), 'repo claude\n', r.stdout + r.stderr);
  assert.match(r.stdout, /CLAUDE\.md skipped: personalised, never pulled/);
}));

test('given a repo folder git cannot read and a different live file, when -Pull runs, then the repo file is kept and the skip is reported', { skip }, withFixture(({ repo, pull }) => {
  // Given
  rmSync(join(repo, '.git'), { recursive: true, force: true });

  // When
  const r = pull({ GIT_CEILING_DIRECTORIES: dirname(repo) });

  // Then
  assert.equal(read(repo, 'rules/a.md'), 'repo rule\n', r.stdout + r.stderr);
  assert.match(r.stdout, /rules\/a\.md skipped: git cannot tell/);
  assert.equal(r.status, 0, r.stdout + r.stderr);
}));

test('given skipped files, when -Pull runs, then it still exits 0', { skip }, withFixture(({ repo, pull }) => {
  // Given
  put(repo, 'rules/a.md', 'my unsaved work\n');

  // When
  const r = pull();

  // Then
  assert.equal(r.status, 0, r.stdout + r.stderr);
}));
