#!/usr/bin/env node
/** Probe A7.1: two different defects sharing filler words at one anchor must not merge into a CONFIRMED A+B finding. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows', 'review-pair.js'), 'utf8')
  .replace(/^export /, '');
const AsyncFunction = (async () => {}).constructor;

async function mergerInput(findingsA, findingsB) {
  const files = Array.from({ length: 6 }, (_, i) => `src/f${i}.cs`);
  const spawned = [];
  const agent = async (prompt, opts = {}) => {
    spawned.push({ ...opts, prompt });
    if (opts.agentType === 'code-reviewer') return { status: 'ISSUES', checked: 'read it', findings: opts.model === 'sonnet' ? findingsA : findingsB };
    return 'REPORT';
  };
  const run = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', SOURCE);
  await run({ range: 'origin/main...HEAD', files }, agent, (t) => Promise.all(t.map((f) => f())), () => {}, () => {}, () => {}, {}, null);
  const prompt = spawned.find((o) => o.label === 'merge the reviews into one report').prompt;
  return JSON.parse(prompt.slice(prompt.indexOf('Results (JSON):') + 16));
}
const mk = (failure) => ({ title: 'T', anchor: 'src/a.cs:3', category: 'correctness', verdict: 'PLAUSIBLE', status: 'todo', priority: 'P2', failure, evidence: 'e' });

test('given two different failures at one anchor that share filler words, when merged, then they stay apart and are not CONFIRMED', async () => {
  // Given
  const a = [mk('null deref when the list is empty')];
  const b = [mk('wrong total when the list is empty')];

  // When
  const input = await mergerInput(a, b);

  // Then
  assert.equal(input.findings.length, 2);
  assert.ok(input.findings.every((f) => f.verdict === 'PLAUSIBLE'));
});

test('given the same failure worded with filler words, when merged, then one A+B CONFIRMED finding', async () => {
  // Given
  const a = [mk('null deref when the list is empty')];
  const b = [mk('null deref if the list is empty')];

  // When
  const input = await mergerInput(a, b);

  // Then
  assert.equal(input.findings.length, 1);
  assert.equal(input.findings[0].foundBy, 'A+B');
});
