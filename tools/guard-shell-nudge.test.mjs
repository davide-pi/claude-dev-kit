// Tests for hooks/guard-shell.js: batch nudge. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HOOK, created, run, asks, nudgeFor, NUDGE, seededConfig, stateFile, hookInput, runHook } from './guard-shell-shared.test.mjs';

/** Feed `nudgeFor` one call per entry of `times`; the texts it returned and the final record. */
function feed(times, record = null) {
  const texts = [];
  for (const now of times) {
    const out = nudgeFor(record, now);
    record = out.record;
    texts.push(out.text);
  }
  return { texts, record };
}

test('given four single shell calls in a row, when the fifth arrives, then nudgeFor returns the batching nudge', () => {
  // Given
  const { record } = feed([10_000, 20_000, 30_000, 40_000]);
  // When
  const { texts } = feed([50_000], record);
  // Then
  assert.equal(record.run, 4);
  assert.equal(texts[0], NUDGE);
});

test('given four single shell calls in the cache, when the fifth arrives, then it is allowed with only the batching nudge and logged', () => {
  // Given
  const config = seededConfig();
  // When
  const out = runHook(config, 'git status');
  // Then
  assert.deepEqual(out, { hookEventName: 'PreToolUse', additionalContext: NUDGE });
  const logged = JSON.parse(readFileSync(join(config, '.cache', 'batch-nudge.log'), 'utf8').trim());
  assert.deepEqual({ session: logged.session, run: logged.run }, { session: 's1', run: 5 });
});

test('given a run already nudged, when a sixth single call arrives, then there is no second nudge', () => {
  // Given
  const { record } = feed([10_000, 20_000, 30_000, 40_000, 50_000]);
  // When
  const { texts } = feed([60_000, 70_000], record);
  // Then
  assert.equal(record.nudged, true);
  assert.deepEqual(texts, [null, null]);
});

test('given two calls 100 ms apart, when the next single call arrives, then the run restarts from one', () => {
  // Given
  const { record } = feed([10_000, 20_000, 30_000, 30_100]);
  // When
  const { record: next } = feed([40_000], record);
  // Then
  assert.equal(record.run, 0);
  assert.equal(next.run, 1);
});

test('given a record idle for 10 minutes, when a single call arrives, then the run restarts from one', () => {
  // Given
  const { record } = feed([10_000, 20_000, 30_000, 40_000]);
  // When
  const { record: next, texts } = feed([40_000 + 10 * 60 * 1000 + 1], record);
  // Then
  assert.equal(next.run, 1);
  assert.deepEqual(texts, [null]);
});

test('given a subagent payload, when it sends a fifth single call, then there is no nudge and the state is untouched', () => {
  // Given
  const config = seededConfig();
  const before = readFileSync(stateFile(config), 'utf8');
  // When
  const out = runHook(config, 'git status', { agent_id: 'a1', agent_type: 'implementer' });
  // Then
  assert.equal(out, null);
  assert.equal(readFileSync(stateFile(config), 'utf8'), before);
});

test('given a fifth single call the output filter rewrites, when the guard answers, then the rewrite carries the nudge', () => {
  // Given
  const config = seededConfig();
  // When
  const out = runHook(config, 'dotnet test');
  // Then
  assert.equal(out.permissionDecision, 'allow');
  assert.ok(out.updatedInput.command.includes('dotnet test'));
  assert.equal(out.additionalContext, NUDGE);
});

test('given a fifth single call that asks, when the guard answers, then the ask carries no nudge and the state is untouched', () => {
  // Given
  const config = seededConfig();
  const before = readFileSync(stateFile(config), 'utf8');
  // When
  const out = runHook(config, 'docker compose down -v');
  // Then
  assert.equal(out.permissionDecision, 'ask');
  assert.equal(out.additionalContext, undefined);
  assert.equal(readFileSync(stateFile(config), 'utf8'), before);
});

test('given an unwritable cache dir, when a single call arrives, then the guard decision is unchanged', () => {
  // Given
  const config = mkdtempSync(join(tmpdir(), 'guard-nudge-'));
  created.push(config);
  writeFileSync(join(config, '.cache'), 'a file where the cache dir should be');
  // When
  const out = runHook(config, 'dotnet test');
  // Then
  assert.equal(out.permissionDecision, 'allow');
  assert.ok(out.updatedInput.command.includes('dotnet test'));
  assert.equal(out.additionalContext, undefined);
});

test('given four single calls in the cache, when two calls of one message run concurrently, then neither nudges and the run is reset', async () => {
  // Given
  const config = seededConfig();
  const once = () => new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, CLAUDE_CONFIG_DIR: config } });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('close', () => resolve(stdout));
    child.stdin.end(hookInput('git status'));
  });
  // When
  const outputs = await Promise.all([once(), once()]);
  // Then
  assert.deepEqual(outputs, ['', '']);
  const times = readFileSync(stateFile(config), 'utf8').split('\n').filter(Boolean).map(Number).sort((a, b) => a - b);
  assert.equal(times.length, 6);
  assert.equal(feed(times).record.run, 0);
});

test('given another session file and a leftover tmp idle for two hours, when a call earns no nudge, then both are pruned', () => {
  // Given
  const config = mkdtempSync(join(tmpdir(), 'guard-nudge-'));
  created.push(config);
  mkdirSync(join(config, '.cache'), { recursive: true });
  const stale = [join(config, '.cache', 'batch-nudge-old.txt'), join(config, '.cache', 'batch-nudge-old.txt.123.tmp')];
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const file of stale) { writeFileSync(file, '1\n'); utimesSync(file, twoHoursAgo, twoHoursAgo); }
  // When
  const out = runHook(config, 'git status');
  // Then
  assert.equal(out?.additionalContext, undefined);
  assert.deepEqual(stale.map(existsSync), [false, false]);
  assert.ok(existsSync(stateFile(config)));
});
