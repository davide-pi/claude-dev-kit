// Tests for install/environment.ps1: a docker CLI that never answers (daemon stopped) can't hang the installer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENVIRONMENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'install', 'environment.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;
const skip = process.platform !== 'win32' ? 'the fake docker is a .cmd' : hasPwsh ? false : 'pwsh 7 not on PATH';

test('given a docker CLI that never answers, when Get-LocalImage runs, then it returns no image within the timeout', { skip }, () => {
  // Given
  const bin = mkdtempSync(join(tmpdir(), 'kit-docker-'));
  writeFileSync(join(bin, 'docker.cmd'), '@echo off\r\nping -n 60 127.0.0.1 >nul\r\necho redis:7\r\n');
  const script = `. '${ENVIRONMENT}'; $r = Get-LocalImage 'redis'; if ($null -eq $r) { 'none' } else { "image:$r" }`;
  try {
    // When
    const started = Date.now();
    const run = spawnSync('pwsh', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      timeout: 40000,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    const seconds = (Date.now() - started) / 1000;
    // Then
    assert.equal(run.stdout.trim(), 'none', run.stderr);
    assert.ok(seconds < 20, `took ${seconds} s`);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test('given a docker CLI that answers at once, when Get-LocalImage runs, then it returns the pulled image', { skip }, () => {
  // Given
  const bin = mkdtempSync(join(tmpdir(), 'kit-docker-'));
  writeFileSync(join(bin, 'docker.cmd'), '@echo off\r\necho ^<none^>:^<none^>\r\necho redis:7\r\n');
  const script = `. '${ENVIRONMENT}'; $r = Get-LocalImage 'redis'; if ($null -eq $r) { 'none' } else { "image:$r" }`;
  try {
    // When
    const run = spawnSync('pwsh', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      timeout: 40000,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    // Then
    assert.equal(run.stdout.trim(), 'image:redis:7', run.stderr);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
