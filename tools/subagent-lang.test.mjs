#!/usr/bin/env node
/**
 * Tests for hooks/subagent-lang.js (SubagentStart). Zero dependencies — `node:test` on Node 18+.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'subagent-lang.js');
const LARGE_READ = 'A persisted tool output over 20 KB, any transcript, or a text file over 256 KB is never read whole: Grep it, or Read it with offset and limit.';
const REPORT = "Your final message is read by the main session, which pays for every word: line 1 is the answer or outcome; then only what it'll act on, one fact per bullet with its file:line, an unknown as ? <what>: <why>; no narrated steps, restated brief, code or tool output it didn't ask for; at most 15 lines unless the brief, a schema or your own Output section sets the shape.";
const created = [];
process.on('exit', () => {
  for (const dir of created) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp */ } }
});

function run(map, input, settings) {
  const config = mkdtempSync(join(tmpdir(), 'sal-'));
  created.push(config);
  if (map !== null) writeFileSync(join(config, 'workspaces.json'), JSON.stringify(map));
  if (settings !== undefined) writeFileSync(join(config, 'settings.json'), settings);
  const r = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', input, env: { ...process.env, CLAUDE_CONFIG_DIR: config } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

test('prints the Lang line for the payload cwd as SubagentStart context', () => {
  const root = join(tmpdir(), 'sal-root');
  const out = run({ lang: { pr: 'it' }, roots: [{ path: root, platform: 'github', lang: { commit: 'fr' } }] }, JSON.stringify({ cwd: join(root, 'x'), hook_event_name: 'SubagentStart' }));
  assert.deepEqual(out, { hookEventName: 'SubagentStart', additionalContext: `Lang: commit fr · pr it · prComment en · items en · wiki en\n${LARGE_READ}\n${REPORT}` });
});

test('no map → English everywhere; unparsable input → silent', () => {
  assert.equal(run(null, JSON.stringify({ cwd: tmpdir() })).additionalContext, `Lang: commit en · pr en · prComment en · items en · wiki en\n${LARGE_READ}\n${REPORT}`);
  assert.equal(run(null, '{ nope'), null);
});

test('given settings.json with language italian, when a subagent starts, then the Lang line starts with chat italian', () => {
  // Given
  const input = JSON.stringify({ cwd: tmpdir(), hook_event_name: 'SubagentStart' });
  // When
  const [lang] = run(null, input, JSON.stringify({ language: 'italian' })).additionalContext.split('\n');
  // Then
  assert.equal(lang, 'Lang: chat italian · commit en · pr en · prComment en · items en · wiki en');
});

test('given no language key or unreadable settings, when a subagent starts, then chat is omitted and nothing throws', () => {
  // Given
  const input = JSON.stringify({ cwd: tmpdir(), hook_event_name: 'SubagentStart' });
  // When
  const noKey = run(null, input, JSON.stringify({ model: 'x' })).additionalContext.split('\n')[0];
  const broken = run(null, input, '{ nope').additionalContext.split('\n')[0];
  // Then
  assert.equal(noKey, 'Lang: commit en · pr en · prComment en · items en · wiki en');
  assert.equal(broken, noKey);
});

test('given any cwd, when a subagent starts, then the context carries the Lang line, the large-read sentence and the report-shape sentence', () => {
  // Given
  const input = JSON.stringify({ cwd: tmpdir(), hook_event_name: 'SubagentStart' });
  // When
  const [lang, sentence, report, ...rest] = run(null, input).additionalContext.split('\n');
  // Then
  assert.match(lang, /^Lang: /);
  assert.equal(sentence, LARGE_READ);
  assert.equal(report, REPORT);
  assert.deepEqual(rest, []);
});
