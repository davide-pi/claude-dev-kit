#!/usr/bin/env node
/**
 * Probe A1.1: secret reads and self-writes hidden in a PowerShell -EncodedCommand payload.
 * Zero dependencies — `node:test` on Node 18+.
 *
 *   node --test tools/guard-shell-encoded-secret.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { evaluate } = createRequire(import.meta.url)(join(ROOT, 'hooks', 'lib', 'guard.js'));

const enc = (text) => Buffer.from(text, 'utf16le').toString('base64');
const run = (command) => evaluate({ tool_name: 'PowerShell', tool_input: { command }, cwd: ROOT, session_id: 's' });

test('Given an encoded `cat .env`, when guard runs, then it denies like the plain form', () => {
  // Given
  const plain = 'pwsh -c "cat .env"';
  const encoded = `pwsh -ec ${enc('cat .env')}`;
  // When
  const plainResult = run(plain);
  const encodedResult = run(encoded);
  // Then
  assert.equal(plainResult?.decision, 'deny');
  assert.equal(encodedResult?.decision, 'deny');
});

test('Given an encoded `Get-Content ~/.ssh/id_rsa`, when guard runs, then it denies', () => {
  // Given
  const command = `pwsh -ec ${enc('Get-Content ~/.ssh/id_rsa')}`;
  // When
  const result = run(command);
  // Then
  assert.equal(result?.decision, 'deny');
});

test('Given an encoded write under ~/.claude/hooks, when guard runs, then it asks like the plain form', () => {
  // Given
  const script = "Set-Content ~/.claude/hooks/x.js 'x'";
  // When
  const plainResult = run(`pwsh -c "${script}"`);
  const encodedResult = run(`pwsh -ec ${enc(script)}`);
  // Then
  assert.equal(plainResult?.decision, 'ask');
  assert.equal(encodedResult?.decision, 'ask');
});
