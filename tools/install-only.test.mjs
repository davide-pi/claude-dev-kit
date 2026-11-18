#!/usr/bin/env node
/**
 * Tests for install.ps1 -Only <paths> -Base <ref> and -Verify -Only <paths>. Each test builds a fixture git repo
 * (a copy of install.ps1 and install/ plus a few assets) and a temp Claude home: nothing touches the real ~/.claude.
 * -Only takes one comma-separated argument. Skipped without pwsh 7.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const skip = hasPwsh ? false : 'pwsh 7 not on PATH';

const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
const put = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

/** Repo at a base commit with rules/a.md, settings.json and tools/x; then the working tree moves on. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-only-'));
  const repo = join(dir, 'repo'), home = join(dir, 'home');
  mkdirSync(repo); mkdirSync(home);
  cpSync(join(KIT, 'install.ps1'), join(repo, 'install.ps1'));
  cpSync(join(KIT, 'install'), join(repo, 'install'), { recursive: true });
  put(repo, 'rules/a.md', 'a base\n');
  put(repo, 'settings.json', '{"base":1}\n');
  put(repo, 'tools/x', 'x base\n');
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const baseSha = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  put(repo, 'rules/a.md', 'a new\n');
  put(repo, 'rules/b.md', 'b new\n');
  put(repo, 'settings.json', '{"new":1}\n');
  put(repo, 'tools/x', 'x new\n');
  return { dir, repo, home, baseSha };
}
const install = (f, ...args) =>
  spawnSync('pwsh', ['-NoProfile', '-File', join(f.repo, 'install.ps1'), '-ClaudeHome', f.home, ...args], { cwd: f.repo, encoding: 'utf8', input: '' });
const withFixture = fn => () => { const f = fixture(); try { fn(f); } finally { rmSync(f.dir, { recursive: true, force: true }); } };
const read = (f, rel) => readFileSync(join(f.home, rel), 'utf8');

test('given an installed file that differs from both base and new content, when -Only runs, then it exits 1 naming it and writes no file', { skip }, withFixture(f => {
  // Given
  put(f.home, 'rules/a.md', 'edited by hand\n');
  // When
  const r = install(f, '-Only', 'rules/a.md,rules/b.md', '-Base', f.baseSha);
  // Then
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /rules\/a\.md/);
  assert.equal(read(f, 'rules/a.md'), 'edited by hand\n');
  assert.equal(existsSync(join(f.home, 'rules/b.md')), false);
}));

test('given -Only with settings.json, tools/x and an asset, when it runs, then only the asset is installed and settings.json is untouched', { skip }, withFixture(f => {
  // Given
  put(f.home, 'rules/a.md', 'a base\n');
  put(f.home, 'settings.json', '{"mine":1}\n');
  // When
  const r = install(f, '-Only', 'settings.json,tools/x,rules/a.md', '-Base', f.baseSha);
  // Then
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(f, 'rules/a.md'), 'a new\n');
  assert.equal(read(f, 'settings.json'), '{"mine":1}\n');
  assert.equal(existsSync(join(f.home, 'tools')), false);
}));

test('given a missing installed asset, when -Only runs, then it is installed and -Verify -Only exits 0', { skip }, withFixture(f => {
  // Given: rules/b.md is absent in the home and at base
  // When
  const run = install(f, '-Only', 'rules/b.md', '-Base', f.baseSha);
  const verify = install(f, '-Verify', '-Only', 'rules/b.md');
  // Then
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(read(f, 'rules/b.md'), 'b new\n');
  assert.equal(verify.status, 0, verify.stdout + verify.stderr);
  assert.match(verify.stdout, /rules\/b\.md/);
}));

test('given a file already equal to the new content, when -Only reruns, then the precheck accepts it and exits 0', { skip }, withFixture(f => {
  // Given
  put(f.home, 'rules/a.md', 'a new\n');
  // When
  const r = install(f, '-Only', 'rules/a.md', '-Base', f.baseSha);
  // Then
  assert.equal(r.status, 0, r.stdout + r.stderr);
}));

test('given an empty -Only, when install runs, then it throws and installs nothing', { skip }, withFixture(f => {
  // Given: a fresh home
  // When
  const r = install(f, '-Only', '', '-Base', f.baseSha);
  // Then
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /-Only needs at least one path/);
  assert.equal(existsSync(join(f.home, 'rules')), false);
  assert.equal(existsSync(join(f.home, 'CLAUDE.md')), false);
}));

test('given a home file edited after install, when -Verify -Only runs, then it exits 1 naming it', { skip }, withFixture(f => {
  // Given
  install(f, '-Only', 'rules/b.md', '-Base', f.baseSha);
  put(f.home, 'rules/b.md', 'edited later\n');
  // When
  const r = install(f, '-Verify', '-Only', 'rules/b.md');
  // Then
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /rules\/b\.md/);
}));

test('given -Only with no kit asset among the paths, when it runs, then it exits non-zero with nothing verified', { skip }, withFixture(f => {
  // Given: tools/x and settings.json are never kit assets
  // When
  const r = install(f, '-Only', 'tools/x,settings.json', '-Base', f.baseSha);
  // Then
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /nothing verified/);
}));

test('given -Verify -Only with no kit asset among the paths, when it runs, then it exits non-zero with nothing verified', { skip }, withFixture(f => {
  // Given: tools/x is not a kit asset
  // When
  const r = install(f, '-Verify', '-Only', 'tools/x');
  // Then
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /nothing verified/);
}));

test('given a binary asset that differs from the installed one only in bytes that are not valid UTF-8, when -Verify -Only runs, then it exits 1 naming it', { skip }, withFixture(f => {
  // Given
  writeFileSync(join(f.repo, 'rules', 'blob.dat'), Buffer.from([0x01, 0xff, 0x80, 0x0d, 0x0a, 0x02]));
  mkdirSync(join(f.home, 'rules'), { recursive: true });
  writeFileSync(join(f.home, 'rules', 'blob.dat'), Buffer.from([0x01, 0xff, 0x81, 0x0d, 0x0a, 0x02]));
  // When
  const r = install(f, '-Verify', '-Only', 'rules/blob.dat');
  // Then
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /rules\/blob\.dat/);
}));
