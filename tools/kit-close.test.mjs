#!/usr/bin/env node
/**
 * Tests for tools/kit-close.mjs: the one command that closes a kit change. Every external command goes through an
 * injected runner (canned answers, calls recorded): nothing real runs, nothing is installed, nothing is pushed.
 *
 * Contract under test: closeChange(opts, runner) -> { code, failed, steps, lines }
 *   opts   { root, head, base?, test, findings, message, dirty?: string[], home, run?, dryRun? }
 *   runner (cmd, args, { cwd }) -> { status, stdout, stderr }, argv only, no shell
 *   steps  the step names that ran, in order: gate sweep perimeter commit install verify plugin
 * The perimeter start is read from <root>/<git dir>/deliver/perimeter.md (`opened:` line).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { closeChange } = await import(pathToFileURL(join(HERE, 'kit-close.mjs')).href);

const GREEN = '{"gate":"green","test":"ok","outside":[],"formatOnly":[],"tree":"t1","greenAt":"x","seconds":1}';

/** A root with the perimeter file a run opened; the git dir is ".git" as the fake runner answers. */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'kit-close-'));
  mkdirSync(join(root, '.git', 'deliver'), { recursive: true });
  writeFileSync(join(root, '.git', 'deliver', 'perimeter.md'),
    'branch: feat/x\nstatus: active\nopened: 2026-01-01T10:00:00.000Z\n- tools/\n- rules/\n');
  return root;
}

/** Canned runner: classifies each call and answers it; `calls` records every argv. */
function fakeRunner({ gate = [GREEN], changed = 'rules/a.md\n', porcelain = ' M rules/a.md\n', verifyStatus = 0 } = {}) {
  const calls = [];
  const gateAnswers = [...gate];
  const is = (args, s) => args.some(a => String(a).endsWith(s));
  const run = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
    if (cmd === 'git' && args.includes('rev-parse') && args.includes('--git-dir')) return ok('.git\n');
    if (cmd === 'git' && args.includes('rev-parse')) return ok('abc1234def\n');
    if (cmd === 'git' && args.includes('status')) return ok(porcelain);
    if (cmd === 'git' && args.includes('diff')) return ok(changed);
    if (cmd === 'git') return ok();
    if (is(args, 'gate.mjs')) {
      const out = gateAnswers.length > 1 ? gateAnswers.shift() : gateAnswers[0];
      const verdict = JSON.parse(out).gate;
      const status = verdict === 'red' ? 1 : verdict === 'running' ? 3 : 0;
      return { status, stdout: `noise\n${out}\n`, stderr: '' };
    }
    if (is(args, 'sweep.mjs')) return ok('{"closed":1,"listed":0}\n');
    if (is(args, 'perimeter.ps1')) return ok('perimeter closed: feat/x\n');
    if (is(args, 'install.ps1') && args.includes('-Verify')) return { status: verifyStatus, stdout: 'ok rules/a.md\n', stderr: '' };
    if (is(args, 'install.ps1')) return ok('installed rules/a.md\n');
    if (cmd === 'claude') return ok('plugin test: 3 passed\n');
    return ok();
  };
  return { run, calls };
}

const base = root => ({
  root, head: 'b03a344', test: 'node --test', findings: join(root, 'f.json'), message: 'feat: x',
  home: join(root, 'home'), dirty: [],
});
const gitCalls = (calls, verb) => calls.filter(c => c.cmd === 'git' && c.args.includes(verb));
const withRoot = fn => async () => { const root = fixtureRoot(); try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };

test('given all steps green, when kit-close runs, then the steps run in order and the deciding lines are printed', withRoot(async root => {
  // Given
  const { run } = fakeRunner();
  // When
  const result = await closeChange(base(root), run);
  // Then
  assert.equal(result.code, 0);
  assert.deepEqual(result.steps, ['gate', 'sweep', 'perimeter', 'commit', 'install', 'verify']);
  const text = result.lines.join('\n');
  assert.match(text, /"gate":"green"/);
  assert.match(text, /\{"closed":1,"listed":0\}/);
  assert.match(text, /perimeter closed/);
  assert.match(text, /abc1234/);
  assert.match(text, /installed rules\/a\.md/);
  assert.match(text, /ok rules\/a\.md/);
}));

test('given a red gate, when kit-close runs, then it exits non-zero naming gate and runs no later step', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ gate: ['{"gate":"red","test":"fail"}'] });
  // When
  const result = await closeChange(base(root), run);
  // Then
  assert.notEqual(result.code, 0);
  assert.equal(result.failed, 'gate');
  assert.deepEqual(result.steps, ['gate']);
  assert.equal(calls.some(c => c.args.some(a => /sweep\.mjs|perimeter\.ps1|install\.ps1/.test(String(a)))), false);
  assert.equal(gitCalls(calls, 'commit').length, 0);
}));

test('given a gate still running (exit 3), when kit-close runs, then the gate is rerun with --wait', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ gate: ['{"gate":"running"}', GREEN] });
  // When
  const result = await closeChange(base(root), run);
  // Then
  const gates = calls.filter(c => c.args.some(a => String(a).endsWith('gate.mjs')));
  assert.equal(gates.length, 2);
  assert.equal(gates[0].args.includes('--wait'), false);
  assert.equal(gates[1].args.includes('--wait'), true);
  assert.equal(result.code, 0);
}));

test('given files dirty at start, when it commits, then git add gets explicit paths without them and push is never invoked', withRoot(async root => {
  // Given
  const porcelain = ' M rules/a.md\n M rules/old.md\n?? rules/new.md\n';
  const { run, calls } = fakeRunner({ porcelain });
  // When
  const result = await closeChange({ ...base(root), dirty: ['rules/old.md'] }, run);
  // Then
  assert.equal(result.code, 0);
  const add = gitCalls(calls, 'add');
  assert.equal(add.length, 1);
  assert.ok(add[0].args.includes('rules/a.md') && add[0].args.includes('rules/new.md'));
  assert.equal(add[0].args.includes('rules/old.md'), false);
  assert.doesNotMatch(result.lines.join('\n'), /not committed/);
  assert.equal(add[0].args.includes('-A'), false);
  assert.equal(add[0].args.includes('.'), false);
  assert.equal(gitCalls(calls, 'push').length, 0);
}));

test('given a stray untracked file outside the perimeter, when it commits, then it is left out and listed on one line', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ porcelain: ' M rules/a.md\n?? findings.json\n' });
  // When
  const result = await closeChange(base(root), run);
  // Then
  const add = gitCalls(calls, 'add');
  assert.ok(add[0].args.includes('rules/a.md'));
  assert.equal(add[0].args.includes('findings.json'), false);
  assert.equal(gitCalls(calls, 'commit')[0].args.includes('findings.json'), false);
  assert.match(result.lines.join('\n'), /not committed \(outside perimeter\): findings\.json/);
}));

test('given the base is not passed, when install runs, then it receives the start head as -Base and the changed files as -Only', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ changed: 'rules/a.md\nrules/r.md\n' });
  // When
  await closeChange(base(root), run);
  // Then
  const install = calls.find(c => c.args.some(a => String(a).endsWith('install.ps1')) && !c.args.includes('-Verify'));
  assert.equal(install.cmd, 'pwsh');
  assert.equal(install.args[install.args.indexOf('-Base') + 1], 'b03a344');
  assert.equal(install.args[install.args.indexOf('-Only') + 1], 'rules/a.md,rules/r.md');
}));

test('given a changed path under mods/cockpit/, when it finishes, then claude plugin test runs on the installed mod', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ changed: 'rules/a.md\nmods/cockpit/hooks/x.ts\n' });
  // When
  const result = await closeChange(base(root), run);
  // Then
  assert.equal(result.steps.at(-1), 'plugin');
  const plugin = calls.find(c => c.cmd === 'claude');
  assert.deepEqual(plugin.args.slice(0, 2), ['plugin', 'test']);
  assert.match(plugin.args[2].replaceAll('\\', '/'), /mods\/cockpit$/);
  assert.match(result.lines.join('\n'), /3 passed/);
}));

test('given no changed path under mods/cockpit/, when it finishes, then claude plugin test does not run', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ changed: 'rules/a.md\n' });
  // When
  const result = await closeChange(base(root), run);
  // Then
  assert.equal(calls.some(c => c.cmd === 'claude'), false);
  assert.equal(result.steps.includes('plugin'), false);
}));

test('given an empty diff against base, when kit-close runs, then install and verify are skipped', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ changed: '', porcelain: '' });
  // When
  const result = await closeChange(base(root), run);
  // Then
  assert.equal(result.code, 0);
  assert.equal(result.steps.includes('install'), false);
  assert.equal(calls.some(c => c.args.some(a => /install\.ps1/.test(String(a)))), false);
  assert.match(result.lines.join('\n'), /nothing to install/);
}));

test('given a red verify, when kit-close runs, then it exits non-zero naming verify', withRoot(async root => {
  // Given
  const { run } = fakeRunner({ verifyStatus: 1 });
  // When
  const result = await closeChange(base(root), run);
  // Then
  assert.notEqual(result.code, 0);
  assert.equal(result.failed, 'verify');
}));

test('given the README, when read, then kit-close.mjs, install.ps1 -Only/-Verify and the two new test files are documented', () => {
  // Given
  const readme = readFileSync(join(HERE, '..', 'README.md'), 'utf8');
  // When / Then
  assert.match(readme, /tools\/kit-close\.mjs/);
  assert.match(readme, /install\.ps1 -Only/);
  assert.match(readme, /-Verify/);
  assert.match(readme, /`kit-close`/);
  assert.match(readme, /`install-only`/);
});

test('given a gate last line "skipped: tree unchanged" with exit 0, when kit-close runs, then it goes on to the sweep step instead of stopping at gate', withRoot(async root => {
  // Given
  const { run } = fakeRunner({ gate: ['{"gate":"skipped: tree unchanged","tree":"t1","greenAt":"x","formatOnly":[]}'] });
  // When
  const result = await closeChange(base(root), run);
  // Then
  assert.equal(result.code, 0);
  assert.notEqual(result.failed, 'gate');
  assert.deepEqual(result.steps.slice(0, 2), ['gate', 'sweep']);
}));

test('given a gate line red: tests changed with exit 1, when kit-close runs, then it still stops at gate', withRoot(async root => {
  // Given
  const { run } = fakeRunner({ gate: ['{"gate":"red: tests changed","test":"t.test.mjs"}'] });
  // When
  const result = await closeChange(base(root), run);
  // Then
  assert.equal(result.failed, 'gate');
  assert.deepEqual(result.steps, ['gate']);
}));
