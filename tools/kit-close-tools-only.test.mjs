#!/usr/bin/env node
/**
 * Probe r0-A8-F1: a closing change that touches only repo-only files (tools/, README, install.ps1, .github) must not
 * stop kit-close at install. The real installer exits 1 with 'nothing verified' when no -Only path is a kit asset;
 * the runner here answers exactly that. Nothing real runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { closeChange } = await import(pathToFileURL(join(HERE, 'kit-close.mjs')).href);

const NOTHING = '  ISSUE   nothing verified: no kit asset among the -Only paths\n';

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), 'kit-close-to-'));
}

/** Runner whose installer behaves like the real one: exit 1 and 'nothing verified' for a paths list with no asset. */
function runnerFor(changed, assets = []) {
  const calls = [];
  const is = (args, s) => args.some(a => String(a).endsWith(s));
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const run = (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === 'git' && args.includes('rev-parse')) return ok('abc1234def\n');
    if (cmd === 'git' && args.includes('status')) return ok(' M tools/kit-close.mjs\n M install.ps1\n M .github/workflows/validate.yml\n M README.md\n M rules/a.md\n');
    if (cmd === 'git' && args.includes('diff')) return ok(changed.join('\n') + '\n');
    if (cmd === 'git') return ok();
    if (is(args, 'install.ps1')) {
      const only = args[args.indexOf('-Only') + 1].split(',');
      if (!only.some(p => assets.includes(p))) return { status: 1, stdout: NOTHING, stderr: '' };
      return ok('installed\n');
    }
    return ok();
  };
  return { run, calls };
}

const opts = root => ({
  root, head: 'b03a344', message: 'fix: x',
  home: join(root, 'home'), paths: ['tools/kit-close.mjs', 'install.ps1', '.github/workflows/validate.yml', 'README.md', 'rules/a.md'],
});
const withRoot = fn => async () => { const root = fixtureRoot(); try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };

test('given a diff of only repo-only files, when kit-close runs, then it closes with code 0 and says no kit asset changed', withRoot(async root => {
  // Given
  const { run } = runnerFor(['tools/kit-close.mjs', 'install.ps1', '.github/workflows/validate.yml', 'README.md']);
  // When
  const result = await closeChange(opts(root), run);
  // Then
  assert.equal(result.code, 0, result.lines.join('\n'));
  assert.match(result.lines.join('\n'), /nothing to install: no kit asset changed/);
  assert.ok(!result.steps.includes('verify'));
}));

test('given a diff of repo-only files and one kit asset, when kit-close runs, then it installs and verifies as before', withRoot(async root => {
  // Given
  const { run } = runnerFor(['tools/kit-close.mjs', 'rules/a.md'], ['rules/a.md']);
  // When
  const result = await closeChange(opts(root), run);
  // Then
  assert.equal(result.code, 0, result.lines.join('\n'));
  assert.deepEqual(result.steps.slice(-2), ['install', 'verify']);
}));
