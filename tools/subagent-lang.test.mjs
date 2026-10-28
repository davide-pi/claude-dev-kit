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
const created = [];
process.on('exit', () => {
  for (const dir of created) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp */ } }
});

function run(map, input) {
  const config = mkdtempSync(join(tmpdir(), 'sal-'));
  created.push(config);
  if (map !== null) writeFileSync(join(config, 'workspaces.json'), JSON.stringify(map));
  const r = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', input, env: { ...process.env, CLAUDE_CONFIG_DIR: config } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

test('prints the Lang line for the payload cwd as SubagentStart context', () => {
  const root = join(tmpdir(), 'sal-root');
  const out = run({ lang: { pr: 'it' }, roots: [{ path: root, platform: 'github', lang: { commit: 'fr' } }] }, JSON.stringify({ cwd: join(root, 'x'), hook_event_name: 'SubagentStart' }));
  assert.deepEqual(out, { hookEventName: 'SubagentStart', additionalContext: 'Lang: commit fr · pr it · prComment en · items en · wiki en' });
});

test('no map → English everywhere; unparsable input → silent', () => {
  assert.equal(run(null, JSON.stringify({ cwd: tmpdir() })).additionalContext, 'Lang: commit en · pr en · prComment en · items en · wiki en');
  assert.equal(run(null, '{ nope'), null);
});
