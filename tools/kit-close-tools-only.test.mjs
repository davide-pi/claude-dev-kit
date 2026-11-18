#!/usr/bin/env node
/**
 * Probe r0-A8-F1: a closing change that touches only repo-only files (tools/, README, install.ps1, .github) must not
 * stop kit-close at install. The real installer exits 1 with 'nothing verified' when no -Only path is a kit asset;
 * the runner here answers exactly that. Nothing real runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { closeChange } = await import(pathToFileURL(join(HERE, 'kit-close.mjs')).href);

const GREEN = '{"gate":"green","test":"ok","outside":[],"formatOnly":[],"tree":"t1","greenAt":"x","seconds":1}';
const NOTHING = '  ISSUE   nothing verified: no kit asset among the -Only paths\n';

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'kit-close-to-'));
  mkdirSync(join(root, '.git', 'deliver'), { recursive: true });
  writeFileSync(join(root, '.git', 'deliver', 'perimeter.md'),
    'branch: feat/x\nstatus: active\nopened: 2026-01-01T10:00:00.000Z\n- tools/\n- rules/\n');
  return root;
}

/** Runner whose installer behaves like the real one: exit 1 and 'nothing verified' for a paths list with no asset. */
function runnerFor(changed, assets = []) {
  const calls = [];
  const is = (args, s) => args.some(a => String(a).endsWith(s));
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const run = (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === 'git' && args.includes('--git-dir')) return ok('.git\n');
    if (cmd === 'git' && args.includes('rev-parse')) return ok('abc1234def\n');
    if (cmd === 'git' && args.includes('status')) return ok(' M tools/kit-close.mjs\n');
    if (cmd === 'git' && args.includes('diff')) return ok(changed.join('\n') + '\n');
    if (cmd === 'git') return ok();
    if (is(args, 'gate.mjs')) return ok(`${GREEN}\n`);
    if (is(args, 'sweep.mjs')) return ok('{"closed":1,"listed":0}\n');
    if (is(args, 'perimeter.ps1')) return ok('perimeter closed: feat/x\n');
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
  root, head: 'b03a344', test: 'node --test', findings: join(root, 'f.json'), message: 'fix: x',
  home: join(root, 'home'), dirty: [],
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
