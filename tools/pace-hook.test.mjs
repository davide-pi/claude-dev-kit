#!/usr/bin/env node
/**
 * Tests for hooks/pace.js as the harness runs it: a payload on stdin, JSON or text on stdout, exit 0 always.
 * Zero dependencies, `node:test` on Node 18+.
 *
 *   node --test "tools/*.test.mjs"
 *
 * Each case points CLAUDE_CONFIG_DIR at its own temp directory. The decisions are covered in usage-pace.test.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'pace.js');
const SID = 'abcd1234-0000-4000-8000-000000000002';
const dirs = [];
process.on('exit', () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// `logFires`: drops NODE_TEST_CONTEXT, which turns the fire log off, so the child writes it in its temp config dir.
function run(stdin, pace, { logFires = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pace-hook-'));
  dirs.push(dir);
  if (pace) writeFileSync(join(dir, '.usage-pace.json'), JSON.stringify(pace));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir };
  if (logFires) delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8', env });
  return { status: r.status, out: r.stdout, dir };
}
const fires = (dir) => readFileSync(join(dir, '.cache', 'hook-fires.log'), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
const live = (p5) => ({
  v: 1, updatedAt: Date.now(),
  five_hour: { pct: p5, resetsAt: Date.now() + 3600_000 }, seven_day: { pct: 5, resetsAt: Date.now() + 86_400_000 },
  samples5h: [], samples7d: [],
});

test('Given 93% fresh data, When a Workflow PreToolUse arrives, Then the hook prints a deny and exits 0', () => {
  // Given
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Workflow', tool_input: { args: { brief: 'go' } } });
  // When
  const { status, out } = run(payload, live(93));
  // Then
  assert.equal(status, 0);
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
});

test('Given 75% fresh data, When a UserPromptSubmit arrives, Then the hook prints additionalContext', () => {
  // Given
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: SID, prompt: 'hi' });
  // When
  const { status, out } = run(payload, live(75));
  // Then
  assert.equal(status, 0);
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /5h window at 75%/);
});

test('Given no usage file, garbage on stdin or an empty stdin, When the hook runs, Then it prints nothing and exits 0', () => {
  // Given
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Agent' });
  // When
  const none = run(payload, null);
  const garbage = run('{not json', live(95));
  const empty = run('', live(95));
  // Then
  for (const r of [none, garbage, empty]) { assert.equal(r.status, 0); assert.equal(r.out, ''); }
});

test('Given an armed chat, When PreCompact arrives, Then stdout is plain text with the checkpoint path', () => {
  // Given
  const dir = mkdtempSync(join(tmpdir(), 'pace-hook-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(dir, '.cache', 'pace', `${SID}.json`), JSON.stringify({ checkpoint: 'C:/x/resume.md' }));
  // When
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreCompact', session_id: SID, trigger: 'auto' }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  });
  // Then
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage-pace checkpoint: C:\/x\/resume\.md/);
});

test('Given an armed chat, When PreCompact arrives, Then the pace file records compactedAt and keeps its fields', () => {
  // Given
  const dir = mkdtempSync(join(tmpdir(), 'pace-hook-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  const file = join(dir, '.cache', 'pace', `${SID}.json`);
  writeFileSync(file, JSON.stringify({ v: 1, sessionId: SID, checkpoint: 'C:/x/resume.md', ready: true }));
  const before = Date.now();
  // When
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreCompact', session_id: SID, trigger: 'manual' }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  });
  // Then
  assert.equal(r.status, 0);
  const got = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(got.compactedAt >= before, `compactedAt ${got.compactedAt}`);
  assert.equal(got.ready, true);
  assert.equal(got.checkpoint, 'C:/x/resume.md');
});

test('Given a torn usage file and a valid payload, When the hook runs, Then it prints nothing and exits 0', () => {
  // Given
  const dir = mkdtempSync(join(tmpdir(), 'pace-hook-'));
  dirs.push(dir);
  writeFileSync(join(dir, '.usage-pace.json'), '{"v":1,');
  // When
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Workflow', tool_input: { args: { brief: 'go' } } }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  });
  // Then
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(KIT, rel), 'utf8');

test('Given 96% fresh data, When a Bash PreToolUse arrives, Then additionalContext carries the notice and no deny', () => {
  // Given
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Bash', tool_input: { command: 'ls' } });
  // When
  const { status, out } = run(payload, live(96.5));
  // Then
  assert.equal(status, 0);
  const o = JSON.parse(out).hookSpecificOutput;
  assert.equal(o.hookEventName, 'PreToolUse');
  assert.match(o.additionalContext, /--ready --session abcd1234/);
  assert.equal(o.permissionDecision, undefined);
});

test('Given 50% fresh data, When a Bash PreToolUse arrives, Then the hook prints nothing', () => {
  // Given
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Bash', tool_input: {} });
  // When
  const { status, out } = run(payload, live(50));
  // Then
  assert.equal(status, 0);
  assert.equal(out, '');
});

test('Given an armed chat, When SessionStart resume arrives, Then additionalContext names the checkpoint and the verify-first order', () => {
  // Given
  const dir = mkdtempSync(join(tmpdir(), 'pace-hook-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(dir, '.cache', 'pace', `${SID}.json`), JSON.stringify({ checkpoint: 'C:/x/resume.md' }));
  // When
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: SID, source: 'resume' }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  });
  // Then
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(o.hookEventName, 'SessionStart');
  assert.match(o.additionalContext, /C:\/x\/resume\.md/);
  assert.match(o.additionalContext, /read it and verify the real state first/i);
});

test('Given a cold start, When the hook handles a payload, Then it costs under 80 ms over the node floor', () => {
  // Given
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Bash', tool_input: {} });
  const timed = (args, input) => {
    const t = process.hrtime.bigint();
    spawnSync(process.execPath, args, { input, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: tmpdir() } });
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  const median = (xs) => [...xs].sort((a, b) => a - b)[1];
  // When
  const floor = median([1, 2, 3].map(() => timed(['-e', '0'], '')));
  const hook = median([1, 2, 3].map(() => timed([HOOK], payload)));
  // Then
  assert.ok(hook - floor < 80, `hook ${hook.toFixed(0)} ms, node floor ${floor.toFixed(0)} ms`);
});

test('Given the settings template, When the hooks are read, Then pace.js is registered for the four events and pace-state is allowed, resume-task is not', () => {
  // Given
  const s = JSON.parse(read('settings.json'));
  const runsPace = (g) => (g.hooks || []).some((h) => (h.args || []).join(' ').includes("/pace.js'"));
  // When
  const pre = s.hooks.PreToolUse.filter(runsPace);
  const allow = s.permissions.allow;
  // Then
  assert.ok(pre.some((g) => g.matcher === 'Bash|PowerShell|Agent|Task|Workflow'));
  assert.ok(s.hooks.UserPromptSubmit.some(runsPace));
  assert.ok(s.hooks.SessionStart.some((g) => runsPace(g) && /resume/.test(g.matcher) && /compact/.test(g.matcher)));
  assert.ok(s.hooks.PreCompact.some(runsPace));
  for (const tool of ['Bash', 'PowerShell']) {
    assert.ok(allow.some((a) => a.startsWith(`${tool}(`) && a.includes('scripts/pace-state.mjs')), `${tool} pace-state`);
    assert.ok(!allow.some((a) => a.includes('scripts/resume-task.ps1')), `${tool} resume-task is gone`);
  }
});

test('Given the README, When the hooks and scripts rows are read, Then every pace file has one', () => {
  // Given
  const readme = read('README.md');
  // When / Then
  for (const f of ['hooks/pace.js', 'scripts/pace-state.mjs']) {
    assert.ok(readme.includes(`\`${f}\``), `${f} has no README row`);
  }
  for (const f of ['resume-task.ps1', 'resume-launch.ps1', 'CLAUDE_PACE_NO_SCHEDULER']) assert.ok(!readme.includes(f), `README still names ${f}`);
  assert.ok(readme.includes('docs/usage-pace.md'), 'README points to the doc');
});

test('Given docs/usage-pace.md, When it is read, Then it covers bands, files, resume and the cockpit contract, and no Windows task', () => {
  // Given
  const doc = read('docs/usage-pace.md');
  // When / Then
  for (const band of ['70', '85', '92', '96', '98']) assert.ok(doc.includes(`| ${band} |`), `doc has no row for band ${band}`);
  for (const word of ['.usage-pace.json', '.mod.json', 'aliveAt', 'claude --resume']) {
    assert.ok(doc.includes(word), `doc lacks ${word}`);
  }
  for (const word of ['resume-task.ps1', 'resume-launch.ps1', 'Register-ScheduledTask', 'claude-resume-<id8>']) assert.ok(!doc.includes(word), `doc still names ${word}`);
});

test('Given 93% fresh data, When a Workflow PreToolUse is denied, Then the fire log records the pace hook with its deny', () => {
  // Given
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Workflow', tool_input: { args: { brief: 'go' } } });
  // When
  const { dir } = run(payload, live(93), { logFires: true });
  // Then
  assert.deepEqual(fires(dir).map(({ hook, event, decision }) => ({ hook, event, decision })), [{ hook: 'pace', event: 'PreToolUse', decision: 'deny' }]);
});

test('Given no pace data, When a prompt arrives, Then the fire log records the pace hook as silent', () => {
  // Given
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: SID, prompt: 'x' });
  // When
  const { dir } = run(payload, null, { logFires: true });
  // Then
  assert.deepEqual(fires(dir).map(({ hook, event, decision }) => ({ hook, event, decision })), [{ hook: 'pace', event: 'UserPromptSubmit', decision: 'silent' }]);
});
