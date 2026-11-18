#!/usr/bin/env node
/**
 * Tests for .github/workflows/validate.yml: the CI guardrail is plain text, so these read it as text.
 *
 *   node --test "tools/ci-workflow.test.mjs"
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const yml = readFileSync(join(ROOT, '.github', 'workflows', 'validate.yml'), 'utf8').replace(/\r\n/g, '\n');

test('given validate.yml, when read, then setup-node uses Node 22 and never 20', () => {
  // Given / When
  const versions = [...yml.matchAll(/node-version:\s*'?"?(\d+)/g)].map(m => m[1]);
  // Then
  assert.ok(versions.length > 0);
  assert.deepEqual([...new Set(versions)], ['22']);
});

test('given validate.yml, when read, then a job runs the tests on windows-latest', () => {
  // Given / When
  const windowsJob = yml.split(/\n(?=  \w[\w-]*:\n)/).find(block => /runs-on:\s*windows-latest/.test(block));
  // Then
  assert.ok(windowsJob, 'no job runs on windows-latest');
  assert.match(windowsJob, /node --test[^\n]*tools\/\*\.test\.mjs/);
});

test('given the syntax-check step, when read, then it covers scripts/*.mjs and workflows/*.js too', () => {
  // Given
  const step = yml.slice(yml.indexOf('Syntax-check hooks and tools'));
  // When / Then
  assert.match(step, /scripts\/\*\.mjs/);
  assert.match(step, /workflows\/\*\.js/);
});

test('given validate.yml, when read, then it states that the mods/cockpit tests and the evals run locally only', () => {
  // Given / When / Then
  assert.match(yml, /#[^\n]*mods\/cockpit[^\n]*(locally|local only)/i);
  assert.match(yml, /#[^\n]*evals[^\n]*(locally|local only)/i);
});

test('given a windows checkout, when .gitattributes is read, then text files stay LF so the byte-equal checks pass', () => {
  // Given
  const attrs = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
  // When / Then
  assert.match(attrs, /^\* text=auto eol=lf$/m);
});
