#!/usr/bin/env node
/**
 * Tests for tools/kit-close.mjs: the one command that closes a kit change. Every external command goes through an
 * injected runner (canned answers, calls recorded): nothing real runs, nothing is installed, nothing is pushed.
 *
 * Contract under test: closeChange(opts, runner) -> { code, failed, steps, lines }
 *   opts   { root, head, base?, message, paths: string[], home, dryRun? }
 *   runner (cmd, args, { cwd }) -> { status, stdout, stderr }, argv only, no shell
 *   steps  the step names that ran, in order: commit install verify plugin
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { closeChange } = await import(pathToFileURL(join(HERE, 'kit-close.mjs')).href);

/** A throwaway root: the runner is faked, so nothing in it is read. */
function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), 'kit-close-'));
}

/** Canned runner: classifies each call and answers it; `calls` records every argv. */
function fakeRunner({ changed = 'rules/a.md\n', porcelain = ' M rules/a.md\n M rules/r.md\n?? rules/new.md\n M mods/cockpit/hooks/x.ts\n', verifyStatus = 0, verifyOut = 'ok rules/a.md\n' } = {}) {
  const calls = [];
  const is = (args, s) => args.some(a => String(a).endsWith(s));
  const run = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
    if (cmd === 'git' && args.includes('rev-parse')) return ok('abc1234def\n');
    if (cmd === 'git' && args.includes('status')) return ok(porcelain);
    if (cmd === 'git' && args.includes('diff')) return ok(changed);
    if (cmd === 'git') return ok();
    if (is(args, 'install.ps1') && args.includes('-Verify')) return { status: verifyStatus, stdout: verifyOut, stderr: '' };
    if (is(args, 'install.ps1')) return ok('installed rules/a.md\n');
    if (cmd === 'claude') return ok('plugin test: 3 passed\n');
    return ok();
  };
  return { run, calls };
}

const base = root => ({
  root, head: 'b03a344', message: 'feat: x',
  home: join(root, 'home'), paths: ['rules/a.md', 'rules/r.md', 'rules/new.md', 'mods/cockpit/hooks/x.ts'],
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
  assert.deepEqual(result.steps, ['commit', 'install', 'verify']);
  const text = result.lines.join('\n');
  assert.match(text, /abc1234/);
  assert.match(text, /installed rules\/a\.md/);
  assert.match(text, /ok rules\/a\.md/);
}));

test('given files outside --paths, when it commits, then git add gets only the --paths files and push is never invoked', withRoot(async root => {
  // Given
  const porcelain = ' M rules/a.md\n M rules/old.md\n?? rules/new.md\n';
  const { run, calls } = fakeRunner({ porcelain });
  // When
  const result = await closeChange({ ...base(root), paths: ['rules/a.md', 'rules/new.md'] }, run);
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

test('given no --paths, when kit-close runs, then it exits 2 with a clear message and runs nothing', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner();
  // When
  const result = await closeChange({ ...base(root), paths: [] }, run);
  // Then
  assert.equal(result.code, 2);
  assert.match(result.lines.join(' '), /--paths is required/);
  assert.equal(calls.length, 0);
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
  const { run, calls } = fakeRunner({ changed: '' });
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

test('given a verify that checked zero assets, when kit-close runs, then it does not print repo == home and stops at verify', withRoot(async root => {
  // Given: the verify exits 0 but says it checked nothing
  const { run } = fakeRunner({ verifyOut: '  nothing verified: no kit asset among the -Only paths\n' });
  // When
  const result = await closeChange(base(root), run);
  // Then
  assert.notEqual(result.code, 0);
  assert.equal(result.failed, 'verify');
  assert.doesNotMatch(result.lines.join('\n'), /repo == home/);
}));

test('given a --paths directory, when it commits, then every dirty file under it is staged', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ porcelain: ' M skills/plan-work/SKILL.md\n?? skills/plan-work/references/tables.md\n M rules/old.md\n' });
  // When
  const result = await closeChange({ ...base(root), paths: ['skills/plan-work'] }, run);
  // Then
  assert.equal(result.code, 0);
  const add = gitCalls(calls, 'add')[0].args;
  assert.ok(add.includes('skills/plan-work/SKILL.md') && add.includes('skills/plan-work/references/tables.md'));
  assert.equal(add.includes('rules/old.md'), false);
}));

test('given ./ and backslash --paths, when it commits, then they match the repo-relative files', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ porcelain: ' M rules/a.md\n M skills/plan-work/SKILL.md\n' });
  // When
  const result = await closeChange({ ...base(root), paths: ['./rules/a.md', 'skills\\plan-work\\'] }, run);
  // Then
  assert.equal(result.code, 0);
  const add = gitCalls(calls, 'add')[0].args;
  assert.ok(add.includes('rules/a.md') && add.includes('skills/plan-work/SKILL.md'));
}));

test('given one --paths entry matching nothing, when it commits, then it fails naming the entry and commits nothing', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ porcelain: ' M rules/a.md\n' });
  // When
  const result = await closeChange({ ...base(root), paths: ['rules/a.md', 'rules/typo.md'] }, run);
  // Then
  assert.equal(result.code, 1);
  assert.equal(result.failed, 'commit');
  assert.match(result.lines.join('\n'), /rules\/typo\.md/);
  assert.equal(gitCalls(calls, 'add').length, 0);
}));

test('given every --paths entry matching nothing, when it commits, then it fails instead of reporting nothing to commit', withRoot(async root => {
  // Given
  const { run } = fakeRunner({ porcelain: ' M rules/old.md\n' });
  // When
  const result = await closeChange({ ...base(root), paths: ['rules/nope.md'] }, run);
  // Then
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.lines.join('\n'), /nothing to commit/);
}));

test('given the --paths already committed and nothing dirty, when it reruns, then it reports nothing to commit and continues to install', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ porcelain: '', changed: 'rules/a.md\nrules/r.md\n' });
  // When
  const result = await closeChange({ ...base(root), paths: ['rules/a.md', 'rules/r.md'] }, run);
  // Then
  assert.equal(result.code, 0);
  assert.match(result.lines.join('\n'), /nothing to commit \(HEAD abc1234def\)/);
  assert.deepEqual(result.steps, ['commit', 'install', 'verify']);
  assert.equal(gitCalls(calls, 'add').length, 0);
}));

test('given one --paths entry committed and another dirty, when it commits, then only the dirty one is staged', withRoot(async root => {
  // Given
  const { run, calls } = fakeRunner({ porcelain: ' M rules/r.md\n', changed: 'rules/a.md\n' });
  // When
  const result = await closeChange({ ...base(root), paths: ['rules/a.md', 'rules/r.md'] }, run);
  // Then
  assert.equal(result.code, 0);
  const add = gitCalls(calls, 'add');
  assert.equal(add.length, 1);
  assert.ok(add[0].args.includes('rules/r.md') && !add[0].args.includes('rules/a.md'));
}));

test('given an entry that is neither dirty nor committed, when it reruns, then it fails naming the typo', withRoot(async root => {
  // Given
  const { run } = fakeRunner({ porcelain: '', changed: 'rules/a.md\n' });
  // When
  const result = await closeChange({ ...base(root), paths: ['rules/a.md', 'rules/typo.md'] }, run);
  // Then
  assert.equal(result.code, 1);
  assert.equal(result.failed, 'commit');
  assert.match(result.lines.join('\n'), /rules\/typo\.md/);
}));
