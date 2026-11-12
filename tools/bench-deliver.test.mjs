import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClaudeJson, makeRecord, summarize, compareRuns, latestPerTask, parseJsonl, buildClaudeArgs, parseArgs, formatCompare,
} from './bench-deliver.mjs';

const rec = (task, solved, regressions, tokens, costUsd, minutes) => ({ task, solved, regressions, tokens, costUsd, minutes });

test('given a result with every token kind and a cost, when parseClaudeJson parses it, then it sums every token kind and reads the cost', () => {
  // Given
  const out = JSON.stringify({ type: 'result', total_cost_usd: 0.42, is_error: false, num_turns: 7,
    usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 } });

  // When / Then
  assert.deepEqual(parseClaudeJson(out), { ok: true, tokens: 100, costUsd: 0.42, isError: false, turns: 7 });
});

test('given an array of results and garbage, when parseClaudeJson parses them, then it takes the last result of the array and survives garbage', () => {
  // Given
  const arr = JSON.stringify([{ type: 'system' }, { type: 'result', total_cost_usd: 1, usage: { output_tokens: 5 } }]);

  // When / Then
  assert.equal(parseClaudeJson(arr).tokens, 5);
  const bad = parseClaudeJson('not json');
  assert.equal(bad.ok, false);
  assert.equal(bad.isError, true);
});

test('given a green and a red oracle, when makeRecord builds the record, then solved needs the oracle green and regressions is a red regression run', () => {
  // Given
  const claude = { tokens: 5, costUsd: 0.1, isError: false };

  // When / Then
  assert.equal(makeRecord({ label: 'a', task: 't', claude, oracleExit: 0, regressionExit: 0, minutes: 1.234 }).solved, true);
  const r = makeRecord({ label: 'a', task: 't', claude, oracleExit: 1, regressionExit: 1, minutes: 1.234 });
  assert.equal(r.solved, false);
  assert.equal(r.regressions, true);
  assert.equal(r.minutes, 1.23);
});

test('given two records, when summarize runs, then it totals the run', () => {
  // Given
  const records = [rec('a', true, false, 100, 0.5, 2), rec('b', false, true, 50, 0.25, 1)];

  // When
  const s = summarize(records);

  // Then
  assert.deepEqual(s, { n: 2, solved: 1, regressions: 1, tokens: 150, costUsd: 0.75, minutes: 3 });
});

test('given a re-run task, when latestPerTask runs, then it keeps the last line of the re-run task', () => {
  // Given / When
  const l = latestPerTask([rec('a', false, false, 1, 0, 1), rec('b', true, false, 1, 0, 1), rec('a', true, false, 1, 0, 1)]);

  // Then
  assert.equal(l.find((r) => r.task === 'a').solved, true);
  assert.equal(l.length, 2);
});

test('given two runs with a task missing on one side, when compareRuns runs, then it reports status change and deltas and tolerates the missing task', () => {
  // Given
  const a = [rec('t1', false, false, 100, 1, 2), rec('t2', true, false, 100, 1, 2)];
  const b = [rec('t1', true, false, 80, 0.5, 1), rec('t3', true, true, 10, 0.1, 1)];

  // When
  const c = compareRuns(a, b);

  // Then
  const t1 = c.rows.find((r) => r.task === 't1');
  assert.deepEqual([t1.before, t1.after, t1.dTokens, t1.dCostUsd, t1.dMinutes], ['unsolved', 'solved', -20, -0.5, -1]);
  assert.equal(c.rows.find((r) => r.task === 't2').after, '-');
  assert.equal(c.rows.find((r) => r.task === 't3').after, 'solved+REG');
  assert.equal(c.rows.find((r) => r.task === 't3').dTokens, null);
  assert.match(formatCompare(c, 'x', 'y'), /TOTAL\s+1\/2\s+2\/2/);
});

test('given JSONL with blank lines, when parseJsonl parses it, then it skips the blank lines', () => {
  // Given / When / Then
  assert.equal(parseJsonl('{"a":1}\n\n{"a":2}\n').length, 2);
});

test('given a budget and flags, when buildClaudeArgs and parseArgs run, then the budget is capped and the flags are read', () => {
  // Given / When
  const a = buildClaudeArgs('fix it', 3, ['--model', 'opus']);

  // Then
  assert.deepEqual(a.slice(0, 6), ['-p', 'fix it', '--output-format', 'json', '--max-budget-usd', '3']);
  assert.deepEqual(a.slice(6), ['--model', 'opus']);
  const o = parseArgs(['--label', 'x', '--dry-run', '--tasks', 'a,b', '--budget', '1.5', '--claude-args', '--model opus']);
  assert.deepEqual([o.label, o.dryRun, o.tasks, o.budget, o.claudeArgs], ['x', true, ['a', 'b'], 1.5, ['--model', 'opus']]);
  assert.throws(() => parseArgs(['--nope']));
});
