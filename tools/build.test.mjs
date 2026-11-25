#!/usr/bin/env node
/**
 * Tests for workflows/build.js with a stubbed `agent`: waves, parallel vs serial implementers, serial verifies,
 * retry, STOP, reviewer model, the round cap, the summary shape and arg validation.
 *
 *   node --test tools/build.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows', 'build.js'), 'utf8')
  .replace(/^export /, '');
const AsyncFunction = (async () => {}).constructor;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLEAN = { findings: [], criteriaMap: [], lostTests: [] };
/** A gate-runner reply in the full contract: exitCode (null when the command did not finish), noTests, line. */
const G = (exitCode, line = 'x', noTests = false) => ({ exitCode, noTests, line });

const task = (id, files, extra = {}) => ({ id, files, criteria: [`Given ${id}, when run, then ok`], verify: `verify-${id}`, dependsOn: [], tdd: false, ...extra });
const base = (tasks, extra = {}) => ({ tasks, testCmd: 'suite-cmd', risk: [], repoRoot: '/repo', request: 'do it', ...extra });

/** Runs the workflow; `handler(opts, prompt)` may return a reply, anything undefined falls back to a green default. */
async function run(args, handler = () => undefined) {
  const calls = [];
  const events = [];
  const live = {};
  const max = {};
  const agent = async (prompt, opts = {}) => {
    calls.push({ ...opts, prompt });
    events.push(`start ${opts.label}`);
    live[opts.agentType] = (live[opts.agentType] ?? 0) + 1;
    max[opts.agentType] = Math.max(max[opts.agentType] ?? 0, live[opts.agentType]);
    await sleep(5);
    live[opts.agentType]--;
    events.push(`end ${opts.label}`);
    const h = await handler(opts, prompt);
    if (h !== undefined) return h;
    if (opts.agentType === 'gate-runner') return G(0, 'ok');
    if (opts.agentType === 'code-reviewer') return CLEAN;
    return 'DONE';
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()));
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', SOURCE);
  const out = await fn(args, agent, parallel, null, () => {}, () => {});
  return { out, calls, events, max, ofType: (t) => calls.filter((c) => c.agentType === t) };
}

test('given a task that depends on another, when the workflow runs, then it starts only after the first is verified', async () => {
  // Given
  const args = base([task('b', ['b.js'], { dependsOn: ['a'] }), task('a', ['a.js'])]);

  // When
  const { events, out } = await run(args);

  // Then
  assert.ok(events.indexOf('end verify a') < events.indexOf('start implement b'), events.join('\n'));
  assert.equal(out.status, 'ok');
});

test('given two tasks on disjoint files, when a wave runs, then their implementers run in parallel', async () => {
  // Given / When
  const { max } = await run(base([task('a', ['a.js']), task('b', ['b.js'])]));

  // Then
  assert.equal(max.implementer, 2);
});

test('given two tasks sharing a file, when a wave runs, then their implementers run serially', async () => {
  // Given / When
  const { max, events } = await run(base([task('a', ['x.js']), task('b', ['x.js', 'y.js'])]));

  // Then
  assert.equal(max.implementer, 1);
  assert.ok(events.indexOf('end implement a') < events.indexOf('start implement b'));
});

test('given a wave of two tasks, when it runs, then the verifies start after every implementer and never overlap', async () => {
  // Given / When
  const { events, max } = await run(base([task('a', ['a.js']), task('b', ['b.js'])]));

  // Then
  const firstVerify = Math.min(events.indexOf('start verify a'), events.indexOf('start verify b'));
  assert.ok(firstVerify > events.indexOf('end implement a') && firstVerify > events.indexOf('end implement b'), events.join('\n'));
  assert.equal(max['gate-runner'], 1);
});

test('given a verify that stays red, when the wave runs, then the task gets one retry and ends failed', async () => {
  // Given
  const handler = (o, p) => (o.agentType === 'gate-runner' && p.includes('verify-a') ? G(1, 'boom') : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.equal(calls.filter((c) => /^(implement|retry) a/.test(c.label)).length, 2);
  assert.equal(calls.filter((c) => c.label.startsWith('verify a')).length, 2);
  assert.match(calls.find((c) => c.label === 'retry a').prompt, /boom/);
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'failed', red: false, line: 'boom' }]);
  assert.equal(out.status, 'failed');
});

test('given a verify red once, when the retry fixes it, then the task is done', async () => {
  // Given
  let n = 0;
  const handler = (o) => (o.label.startsWith('verify a') ? G(++n > 1 ? 0 : 1) : undefined);

  // When
  const { out } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'done', red: false }]);
});

test('given an implementer that replies STOP, when the wave runs, then siblings go on and dependents are skipped', async () => {
  // Given
  const args = base([task('a', ['a.js']), task('b', ['b.js']), task('c', ['c.js'], { dependsOn: ['a'] })]);
  const handler = (o) => (o.label === 'implement a' ? 'STOP: which currency?' : undefined);

  // When
  const { out, calls } = await run(args, handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'stop', red: false }, { id: 'b', state: 'done', red: false }, { id: 'c', state: 'skipped', red: false }]);
  assert.deepEqual(out.stops, [{ id: 'a', question: 'which currency?' }]);
  assert.equal(out.status, 'stop');
  assert.ok(!calls.some((c) => c.label === 'implement c' || c.label === 'verify a'));
});

test('given a risk axis of security, when the reviewer runs, then it is opus at high effort, else sonnet', async () => {
  // Given / When
  const risky = await run(base([task('a', ['a.js'])], { risk: ['security'] }));
  const plain = await run(base([task('a', ['a.js'])], { risk: ['perf'] }));

  // Then
  assert.deepEqual([risky.ofType('code-reviewer')[0].model, risky.ofType('code-reviewer')[0].effort], ['opus', 'high']);
  assert.equal(plain.ofType('code-reviewer')[0].model, 'sonnet');
  assert.ok(plain.ofType('implementer').every((c) => c.model === 'sonnet'));
});

test('given a reviewer that always finds a P1, when the workflow runs, then it stops after 3 rounds with the item still open', async () => {
  // Given
  const finding = { priority: 'P1', file: 'a.js', line: 3, summary: 'broken' };
  const handler = (o) => (o.agentType === 'code-reviewer' ? { ...CLEAN, findings: [finding, { priority: 'P3', file: 'a.js', summary: 'nit' }] } : undefined);

  // When
  const { out, ofType } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.equal(ofType('code-reviewer').length, 3);
  assert.equal(out.rounds, 3);
  assert.equal(ofType('implementer').filter((c) => c.label === 'fix a.js').length, 2);
  assert.deepEqual(out.openFindings, ['P1 a.js:3 broken']);
  assert.equal(out.status, 'failed');
});

test('given a criterion gap and a lost test in different files, when a round ends, then one fix implementer per file runs in parallel', async () => {
  // Given
  let round = 0;
  const handler = (o) => {
    if (o.agentType !== 'code-reviewer') return undefined;
    return ++round > 1 ? CLEAN : {
      findings: [],
      criteriaMap: [{ task: 'a', criterion: 'c1', gap: true, file: 'a.test.js' }],
      lostTests: [{ file: 'b.test.js', test: 'old case' }],
    };
  };

  // When
  const { out, ofType, max } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.deepEqual(ofType('implementer').filter((c) => c.label.startsWith('fix ')).map((c) => c.label).sort(), ['fix a.test.js', 'fix b.test.js']);
  assert.equal(max.implementer, 2);
  assert.equal(out.rounds, 2);
  assert.equal(out.status, 'ok');
});

test('given a clean run, when the workflow ends, then the summary has the documented shape', async () => {
  // Given / When
  const { out } = await run(base([task('a', ['a.js']), task('b', ['b.js'], { dependsOn: ['a'] })]));

  // Then
  assert.deepEqual(Object.keys(out).sort(), ['assumedDone', 'filesChanged', 'openFindings', 'outside', 'rounds', 'status', 'stops', 'suite', 'tasks']);
  assert.deepEqual(out, {
    status: 'ok', tasks: [{ id: 'a', state: 'done', red: false }, { id: 'b', state: 'done', red: false }], assumedDone: [], suite: 'green', rounds: 1, stops: [], openFindings: [], outside: [], filesChanged: ['a.js', 'b.js'],
  });
});

test('given a red suite, when the workflow ends, then suite carries the deciding line and status is not ok', async () => {
  // Given
  const handler = (o) => (o.label === 'suite' ? G(1, '# fail 2') : undefined);

  // When
  const { out } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.equal(out.suite, 'red: # fail 2');
  assert.equal(out.status, 'failed');
});

test('given a dependency id absent from the call, when the workflow runs, then it is treated as done', async () => {
  // Given
  const args = base([task('b', ['b.js'], { dependsOn: ['a'] })], { done: ['a'] });

  // When
  const { out } = await run(args);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'b', state: 'done', red: false }]);
  assert.equal(out.status, 'ok');
});

test('given a dependency id absent from the call, when the workflow ends, then the summary lists it in assumedDone', async () => {
  // Given
  const args = base([task('b', ['b.js'], { dependsOn: ['a'] })], { done: ['a'] });

  // When
  const { out } = await run(args);

  // Then
  assert.deepEqual(out.assumedDone, ['a']);
});

test('given a verify containing a single quote, when the gate runs, then the prompt has the escaped env -C bash -c form', async () => {
  // Given
  const args = base([task('a', ['a.js'], { verify: "echo 'x' && y" })]);

  // When
  const { calls } = await run(args);

  // Then
  const p = calls.find((c) => c.label === 'verify a').prompt;
  assert.ok(p.includes(`env -C '/repo' bash -c 'echo '\\''x'\\'' && y'`), p);
});

test('given a red suite and a finding on the same file, when a fix round runs, then that file has exactly one fixer', async () => {
  // Given
  let round = 0;
  let suites = 0;
  const handler = (o) => {
    if (o.label === 'suite') return G(++suites > 1 ? 0 : 1, '# fail 1');
    if (o.agentType !== 'code-reviewer') return undefined;
    return ++round > 1 ? CLEAN : { ...CLEAN, findings: [{ priority: 'P2', file: 'a.js', summary: 'bad' }] };
  };

  // When
  const { ofType } = await run(base([task('a', ['a.js', 'b.js'])]), handler);

  // Then
  const fixes = ofType('implementer').filter((c) => c.label.startsWith('fix ')).map((c) => c.label).sort();
  assert.deepEqual(fixes, ['fix a.js']);
});

test('given a failed task and a stopped task, when the workflow ends, then status is failed and the stop is still reported', async () => {
  // Given
  const args = base([task('a', ['a.js']), task('b', ['b.js'])]);
  const handler = (o, p) => {
    if (o.label === 'implement b') return 'STOP: which?';
    return o.agentType === 'gate-runner' && p.includes('verify-a') ? G(1, 'boom') : undefined;
  };

  // When
  const { out } = await run(args, handler);

  // Then
  assert.equal(out.status, 'failed');
  assert.deepEqual(out.stops, [{ id: 'b', question: 'which?' }]);
});

test('given a red suite and a clean review, when round 1 ends, then a fix round runs and the suite is re-run', async () => {
  // Given
  let suites = 0;
  const handler = (o) => (o.label === 'suite' ? G(++suites > 1 ? 0 : 1, '# fail 1') : undefined);

  // When
  const { out, ofType, calls } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.equal(ofType('implementer').filter((c) => c.label === 'fix a.js').length, 1);
  assert.match(calls.find((c) => c.label === 'review round 1').prompt, /# fail 1/);
  assert.equal(out.rounds, 2);
  assert.equal(out.suite, 'green');
  assert.equal(out.status, 'ok');
});

test('given bad args, when the workflow runs, then it returns an error status and spawns nothing', async () => {
  for (const args of [
    undefined,
    base([]),
    base([task('a', [])]),
    base([task('a', ['a.js']), task('a', ['b.js'])]),
    base([task('a', ['a.js'], { dependsOn: ['b'] }), task('b', ['b.js'], { dependsOn: ['a'] })]),
    { ...base([task('a', ['a.js'])]), testCmd: '' },
    { ...base([task('a', ['a.js'])]), repoRoot: undefined },
  ]) {
    // Given / When
    const { out, calls } = await run(args);

    // Then
    assert.equal(out.status, 'error');
    assert.ok(out.errors.length > 0);
    assert.equal(calls.length, 0);
  }
});

const tier = (c) => [c.model, c.effort];

test('given tasks with mechanical, high risk, size L and plain, when they run, then each implementer gets its model and effort', async () => {
  // Given
  const args = base([
    task('m', ['m.js'], { mechanical: true }),
    task('r', ['r.js'], { risk: ['concurrency'] }),
    task('l', ['l.js'], { size: 'L' }),
    task('p', ['p.js'], { risk: ['perf'] }),
  ], { risk: ['security'] });

  // When
  const { ofType } = await run(args);

  // Then
  const of = (id) => tier(ofType('implementer').find((c) => c.label === `implement ${id}`));
  assert.deepEqual([of('m'), of('r'), of('l'), of('p')], [['haiku', 'low'], ['opus', 'medium'], ['opus', 'medium'], ['sonnet', 'medium']]);
});

test('given a task with no risk, when the call risk is high, then the task implementer is opus', async () => {
  // Given / When
  const { ofType } = await run(base([task('a', ['a.js'])], { risk: ['data'] }));

  // Then
  assert.deepEqual(tier(ofType('implementer')[0]), ['opus', 'medium']);
});

test('given a task of size L, when the reviewer runs, then it is opus even with no call risk', async () => {
  // Given / When
  const { ofType } = await run(base([task('a', ['a.js'], { size: 'L' })]));

  // Then
  assert.equal(ofType('code-reviewer')[0].model, 'opus');
});

test('given a file declared by a sonnet and an opus task, when a fix runs, then the fixer is opus; an undeclared file gets no fixer', async () => {
  // Given
  let round = 0;
  const handler = (o) => (o.agentType === 'code-reviewer' && ++round === 1
    ? { ...CLEAN, findings: [{ priority: 'P1', file: 'x.js', summary: 'a' }, { priority: 'P1', file: 'other.js', summary: 'b' }] }
    : undefined);
  const args = base([task('a', ['x.js']), task('b', ['x.js'], { size: 'L' })]);

  // When
  const { ofType } = await run(args, handler);

  // Then
  const fix = (f) => { const c = ofType('implementer').find((x) => x.label === `fix ${f}`); return c && tier(c); };
  assert.deepEqual([fix('x.js'), fix('other.js')], [['opus', 'medium'], undefined]);
});

test('given a test-first task, when it runs, then tests-only, a red verify and the implement come before the green verify, and red is reported', async () => {
  // Given
  const handler = (o) => (o.label.startsWith('red verify') ? G(1, 'red!') : o.label === 'verify a' ? G(0, 'ok') : undefined);

  // When
  const { out, events, calls } = await run(base([task('a', ['a.js'], { tdd: true })]), handler);

  // Then
  const order = ['red a', 'red verify a', 'implement a', 'verify a'].map((l) => events.indexOf(`start ${l}`));
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  assert.ok(order.every((i) => i >= 0), events.join('\n'));
  assert.match(calls.find((c) => c.label === 'red a').prompt, /Given\/When\/Then/);
  assert.match(calls.find((c) => c.label === 'implement a').prompt, /red!.*never weaken or delete/);
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'done', red: true, redLine: 'red!' }]);
});

test('given tdd false or mechanical, when the task runs, then there is no red step', async () => {
  // Given
  const args = base([task('a', ['a.js']), task('m', ['m.js'], { tdd: true, mechanical: true })]);

  // When
  const { calls } = await run(args);

  // Then
  assert.deepEqual(calls.filter((c) => c.label.startsWith('red')), []);
});

test('given tests green before the change, when redone and still green, then the task stops and its dependent is skipped', async () => {
  // Given
  const args = base([task('a', ['a.js'], { tdd: true }), task('b', ['b.js'], { dependsOn: ['a'] })]);

  // When
  const { out, calls } = await run(args);

  // Then
  assert.deepEqual(calls.filter((c) => c.label.startsWith('red')).map((c) => c.label), ['red a', 'red verify a', 'red a (retry)', 'red verify a (retry)']);
  assert.deepEqual(out.stops, [{ id: 'a', question: 'tests green before the change' }]);
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'stop', red: false }, { id: 'b', state: 'skipped', red: false }]);
  assert.ok(!calls.some((c) => c.label === 'implement a'));
});

test('given tests green once, when the redo makes them red, then the task goes on to implement', async () => {
  // Given
  let n = 0;
  const handler = (o) => (o.label.startsWith('red verify') ? G(++n === 1 ? 0 : 1) : undefined);

  // When
  const { out } = await run(base([task('a', ['a.js'], { tdd: true })]), handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'done', red: true, redLine: 'x' }]);
});

test('given the reviewer prompt, when a review runs, then it asks for Given/When/Then tests and no lost test', async () => {
  // Given / When
  const { calls } = await run(base([task('a', ['a.js'])]));

  // Then
  const p = calls.find((c) => c.label === 'review round 1').prompt;
  assert.match(p, /Given\/When\/Then in its title and its body/);
  assert.match(p, /no pre-existing test case was deleted or weakened/);
});

test('given a red verify that never ran to completion, when the red check runs, then the task stops without red and its dependent is skipped', async () => {
  // Given
  const args = base([task('a', ['a.js'], { tdd: true }), task('b', ['b.js'], { dependsOn: ['a'] })]);
  const handler = (o) => (o.label.startsWith('red verify') ? G(null, 'timed out') : undefined);

  // When
  const { out, calls } = await run(args, handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'stop', red: false }, { id: 'b', state: 'skipped', red: false }]);
  assert.match(out.stops[0].question, /timed out/);
  assert.ok(!calls.some((c) => c.label === 'implement a'));
});

test('given a gate-runner that crashes on the red check, when the task runs, then it does not get red', async () => {
  // Given
  const handler = (o) => { if (o.label.startsWith('red verify')) throw new Error('crash'); };

  // When
  const { out } = await run(base([task('a', ['a.js'], { tdd: true })]), handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'stop', red: false }]);
});

test('given a gate, when it runs, then the prompt asks for the shell timeout 600000', async () => {
  // Given / When
  const { calls } = await run(base([task('a', ['a.js'])]));

  // Then
  assert.match(calls.find((c) => c.label === 'verify a').prompt, /timeout: 600000/);
});

test('given a dependsOn entry that is not a string or an unknown id, a done that is not an array or a done id that is a task, when the workflow runs, then it errors; a listed done id is accepted', async () => {
  // Given
  const bad = [
    base([task('a', ['a.js'], { dependsOn: [1] })]),
    base([task('a', ['a.js'], { dependsOn: ['zzz'] })]),
    base([task('a', ['a.js'])], { done: 'zzz' }),
    base([task('a', ['a.js'])], { done: ['a'] }),
  ];

  // When
  const results = await Promise.all(bad.map((args) => run(args)));
  const ok = await run(base([task('a', ['a.js'], { dependsOn: ['zzz'] })], { done: ['zzz'] }));

  // Then
  for (const { out, calls } of results) {
    assert.equal(out.status, 'error');
    assert.equal(calls.length, 0);
  }
  assert.deepEqual(results[2].out.errors, ['done must be an array of id strings']);
  assert.match(results[3].out.errors.join('\n'), /done "a"/);
  assert.equal(ok.out.status, 'ok');
});

test('given a done task and a stopped task, when the reviewer runs, then it receives only the done task criteria', async () => {
  // Given
  const handler = (o) => (o.label === 'implement b' ? 'STOP: which?' : undefined);

  // When
  const { calls } = await run(base([task('a', ['a.js']), task('b', ['b.js'])]), handler);

  // Then
  const p = calls.find((c) => c.label === 'review round 1').prompt;
  assert.ok(p.includes('Task a (') && !p.includes('Task b ('), p);
});

test('given a red suite and a stopped task, when the review ends, then no fixer is launched for the suite and the summary reports it red and held back', async () => {
  // Given
  const handler = (o) => (o.label === 'implement b' ? 'STOP: which?' : o.label === 'suite' ? G(1, '# fail 1') : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js']), task('b', ['b.js'])]), handler);

  // Then
  assert.ok(!calls.some((c) => c.label.startsWith('fix ')));
  assert.match(out.suite, /^red: # fail 1 .*held back until the stopped tasks are resolved/);
  assert.equal(out.status, 'stop');
});

test('given a fixer that replies STOP, when the run ends otherwise clean, then status is stop, not ok', async () => {
  // Given
  let round = 0;
  const handler = (o) => {
    if (o.label === 'fix a.js') return 'STOP: which?';
    if (o.agentType !== 'code-reviewer') return undefined;
    return ++round > 1 ? CLEAN : { ...CLEAN, findings: [{ priority: 'P1', file: 'a.js', summary: 'bad' }] };
  };

  // When
  const { out } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.equal(out.suite, 'green');
  assert.equal(out.stops.length, 1);
  assert.equal(out.status, 'stop');
});

test('given a tdd false task and a tdd task, when they are implemented, then only the first brief says test-first: no', async () => {
  // Given
  const args = base([task('a', ['a.js']), task('m', ['m.js'], { tdd: true })]);

  // When
  const { calls } = await run(args, (o) => (o.label === 'red verify m' ? G(1, 'red') : undefined));

  // Then
  assert.match(calls.find((c) => c.label === 'implement a').prompt, /test-first: no/);
  assert.doesNotMatch(calls.find((c) => c.label === 'implement m').prompt, /test-first: no/);
});

test('given a high call risk, when a declared file gets a fix, then the fixer is opus', async () => {
  // Given
  let round = 0;
  const handler = (o) => (o.agentType === 'code-reviewer' && ++round === 1 ? { ...CLEAN, findings: [{ priority: 'P1', file: 'a.js', summary: 'b' }] } : undefined);

  // When
  const { ofType } = await run(base([task('a', ['a.js'])], { risk: ['data'] }), handler);

  // Then
  assert.deepEqual(tier(ofType('implementer').find((c) => c.label === 'fix a.js')), ['opus', 'medium']);
});

test('given a task with tdd omitted, when it runs, then the red step happens', async () => {
  // Given
  const args = base([{ ...task('a', ['a.js']), tdd: undefined }]);

  // When
  const { calls } = await run(args);

  // Then
  assert.ok(calls.some((c) => c.label === 'red a'));
  assert.ok(calls.some((c) => c.label === 'red verify a'));
});

test('given a bad type for size, risk, mechanical or tdd, when the workflow runs, then it returns an error and spawns nothing', async () => {
  for (const extra of [{ size: 'XL' }, { risk: 'data' }, { mechanical: 'yes' }, { tdd: 0 }]) {
    // Given / When
    const { out, calls } = await run(base([task('a', ['a.js'], extra)]));

    // Then
    assert.equal(out.status, 'error');
    assert.equal(calls.length, 0);
  }
});

test('given a suite gate that did not run, when the workflow ends, then suite is not run, no fixer runs for it and status is not ok', async () => {
  // Given
  const handler = (o) => (o.label === 'suite' ? G(-1, 'killed') : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.equal(out.suite, 'not run: killed');
  assert.ok(!calls.some((c) => c.label.startsWith('fix ')));
  assert.notEqual(out.status, 'ok');
});

test('given a green verify that did not run, when the wave verifies, then the task fails without a fix retry', async () => {
  // Given
  const handler = (o) => (o.label === 'verify a' ? G(-1, 'tool error') : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'failed', red: false, line: 'the verify did not run to completion: tool error' }]);
  assert.ok(!calls.some((c) => c.label === 'retry a'));
  assert.equal(out.status, 'failed');
});

test('given an implementer or tests-only call that returns nothing, when the wave runs, then the task stops with implementer returned nothing', async () => {
  // Given
  const args = base([task('a', ['a.js']), task('b', ['b.js'], { tdd: true })]);
  const handler = (o) => {
    if (o.label === 'implement a') throw new Error('crash');
    if (o.label === 'red b') return null;
    return undefined;
  };

  // When
  const { out, calls } = await run(args, handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'stop', red: false }, { id: 'b', state: 'stop', red: false }]);
  assert.deepEqual(out.stops, [{ id: 'b', question: 'implementer returned nothing' }, { id: 'a', question: 'implementer returned nothing' }]);
  assert.ok(!calls.some((c) => c.label === 'verify a' || c.label === 'red verify b'));
});

test('given a fixer on a file no task declares, when it returns nothing, then it is a stop entry and its file is not changed, while a fixer that answers adds it', async () => {
  // Given
  const reply = (fix) => { let round = 0; return (o) => {
    if (o.label === 'fix a.test.js') return fix;
    return o.agentType === 'code-reviewer' && ++round === 1 ? { ...CLEAN, criteriaMap: [{ task: 'a', criterion: 'c1', gap: true, file: 'a.test.js' }] } : undefined;
  }; };

  // When
  const empty = await run(base([task('a', ['a.js'])]), reply(null));
  const done = await run(base([task('a', ['a.js'])]), reply('DONE'));

  // Then
  assert.deepEqual(empty.out.stops, [{ id: 'fix:a.test.js', question: 'implementer returned nothing' }]);
  assert.deepEqual(empty.out.filesChanged, ['a.js']);
  assert.equal(empty.out.status, 'stop');
  assert.deepEqual(done.out.filesChanged, ['a.js', 'a.test.js']);
});

test('given a STOP in bullet, quote or bold form, when the implementer replies, then the task stops; STOP mid-sentence does not', async () => {
  // Given
  const forms = ['- STOP: q', '* STOP: q', '> STOP: q', '**STOP:** q', '`STOP:` q', '- **STOP:** q'];

  // When
  const stopped = await Promise.all(forms.map((r) => run(base([task('a', ['a.js'])]), (o) => (o.label === 'implement a' ? `done.\n${r}` : undefined))));
  const prose = await run(base([task('a', ['a.js'])]), (o) => (o.label === 'implement a' ? 'I did not need to STOP: all fine' : undefined));

  // Then
  for (const { out } of stopped) assert.deepEqual(out.stops, [{ id: 'a', question: 'q' }]);
  assert.deepEqual(prose.out.stops, []);
});

test('given findings on one file written as an absolute, a ./ and a backslash path, when a fix round runs, then that file has one fixer under its relative path', async () => {
  // Given
  let round = 0;
  const finding = (file) => ({ priority: 'P1', file, summary: 's' });
  const handler = (o) => (o.agentType === 'code-reviewer' && ++round === 1
    ? { ...CLEAN, findings: [finding('C:\\repo\\src\\a.js'), finding('./src/a.js'), finding('.\\src\\a.js'), finding('src/a.js')] }
    : undefined);

  // When
  const { ofType, out } = await run(base([task('a', ['src/a.js'], { size: 'L' })], { repoRoot: 'C:\\repo' }), handler);

  // Then
  const fixes = ofType('implementer').filter((c) => c.label.startsWith('fix '));
  assert.deepEqual(fixes.map((c) => c.label), ['fix src/a.js']);
  assert.deepEqual(tier(fixes[0]), ['opus', 'medium']);
  assert.deepEqual(out.filesChanged, ['src/a.js']);
});

test('given a red check that exits 127, when the task runs, then it is not red and stops before implementing', async () => {
  // Given
  const handler = (o) => (o.label.startsWith('red verify') ? G(127, 'command not found') : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js'], { tdd: true })]), handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'stop', red: false }]);
  assert.match(out.stops[0].question, /command not found/);
  assert.ok(!calls.some((c) => c.label === 'implement a'));
});

test('given a red check that fails with no test run, when the task runs, then it is not red and stops before implementing', async () => {
  // Given
  const handler = (o) => (o.label.startsWith('red verify') ? G(1, 'No test matches the given testcase filter', true) : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js'], { tdd: true })]), handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'stop', red: false }]);
  assert.deepEqual(out.stops, [{ id: 'a', question: 'the red check ran no test: No test matches the given testcase filter' }]);
  assert.ok(!calls.some((c) => c.label === 'implement a'));
});

test('given a red check that fails to compile the new tests, when the task runs, then it counts as red and goes on to implement', async () => {
  // Given
  const handler = (o) => (o.label.startsWith('red verify') ? G(1, "error CS0246: The type or namespace name 'Invoice' could not be found") : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js'], { tdd: true })]), handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'done', red: true, redLine: "error CS0246: The type or namespace name 'Invoice' could not be found" }]);
  assert.match(calls.find((c) => c.label === 'implement a').prompt, /error CS0246/);
});

test('given a finding on a stopped task file and a gap of an unknown task, when the round ends, then both stay open with no fixer', async () => {
  // Given
  const handler = (o) => {
    if (o.label === 'implement b') return 'STOP: which?';
    return o.agentType === 'code-reviewer'
      ? { findings: [{ priority: 'P1', file: 'b.test.js', summary: 'frozen' }], criteriaMap: [{ task: 'zzz', criterion: 'c9', gap: true }], lostTests: [] }
      : undefined;
  };

  // When
  const { out, calls } = await run(base([task('a', ['a.js']), task('b', ['b.js', 'b.test.js'])]), handler);

  // Then
  assert.ok(!calls.some((c) => c.label.startsWith('fix ')));
  assert.deepEqual(out.openFindings, ['P1 b.test.js frozen', 'criterion without a test (zzz): c9']);
  assert.deepEqual(out.filesChanged, ['a.js', 'b.js', 'b.test.js']);
});

test('given a fix round, when a fixer is briefed, then it is told never to edit an assertion of a test proven red', async () => {
  // Given
  let round = 0;
  const handler = (o) => (o.agentType === 'code-reviewer' && ++round === 1 ? { ...CLEAN, findings: [{ priority: 'P1', file: 'a.js', summary: 'b' }] } : undefined);

  // When
  const { calls } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.match(calls.find((c) => c.label === 'fix a.js').prompt, /never edit an assertion of a test proven red/i);
});

const fixers = (r) => r.calls.filter((c) => c.phase === 'Fix');

test('given a reviewer that returns outside items on a clean run, when the build ends, then they reach the summary with no fixer and status ok', async () => {
  // Given
  const args = base([task('a', ['a.js'])]);

  // When
  const r = await run(args, (o) => (o.agentType === 'code-reviewer' ? { ...CLEAN, outside: ['old.js:3 — pre-existing smell'] } : undefined));

  // Then
  assert.deepEqual(r.out.outside, ['old.js:3 — pre-existing smell']);
  assert.equal(fixers(r).length, 0);
  assert.equal(r.out.status, 'ok');
});

test('given a finding on a file no task declares and the run did not change, when reviewed, then it lands in outside with no fixer', async () => {
  // Given
  const args = base([task('a', ['a.js'])]);
  const finding = { priority: 'P1', file: '/repo/z.js', line: 7, summary: 'bad thing' };

  // When
  const r = await run(args, (o) => (o.agentType === 'code-reviewer' ? { ...CLEAN, findings: [finding] } : undefined));

  // Then
  assert.deepEqual(r.out.outside, ['z.js:7 — bad thing']);
  assert.deepEqual(r.out.openFindings, []);
  assert.equal(fixers(r).length, 0);
  assert.equal(r.out.rounds, 1);
  assert.equal(r.out.status, 'ok');
});

test('given the same outside item in several rounds, when the build ends, then the summary lists it once', async () => {
  // Given
  const args = base([task('a', ['a.js'])]);
  let n = 0;

  // When
  const r = await run(args, (o) => {
    if (o.agentType !== 'code-reviewer') return undefined;
    n++;
    return n < 3
      ? { ...CLEAN, outside: ['old.js:3 — smell'], findings: [{ priority: 'P2', file: 'a.js', summary: 'fix me' }] }
      : { ...CLEAN, outside: ['old.js:3 — smell'] };
  });

  // Then
  assert.deepEqual(r.out.outside, ['old.js:3 — smell']);
});

test('given more than ten outside items, when the build ends, then the summary keeps ten and a +N more entry', async () => {
  // Given
  const args = base([task('a', ['a.js'])]);
  const many = Array.from({ length: 13 }, (_, i) => `f${i}.js:1 — x`);

  // When
  const r = await run(args, (o) => (o.agentType === 'code-reviewer' ? { ...CLEAN, outside: many } : undefined));

  // Then
  assert.equal(r.out.outside.length, 11);
  assert.equal(r.out.outside[10], '+3 more');
  assert.equal(r.out.outside[0], 'f0.js:1 — x');
});

test('given a finding on a declared file, when reviewed, then it still gets a fixer whose brief limits it to the listed findings', async () => {
  // Given
  const args = base([task('a', ['a.js'])]);
  let n = 0;

  // When
  const r = await run(args, (o) => (o.agentType === 'code-reviewer' && n++ === 0 ? { ...CLEAN, findings: [{ priority: 'P1', file: 'a.js', summary: 's' }] } : undefined));

  // Then
  assert.equal(fixers(r).length, 1);
  assert.match(fixers(r)[0].prompt, /Noticed/);
  assert.match(r.ofType('code-reviewer')[0].prompt, /outside/);
});

test('given a P1 caused by the change on a file no task declares, when reviewed, then it is open, has no fixer, the loop stops and status is failed', async () => {
  // Given
  const args = base([task('a', ['a.js'])]);
  const finding = { priority: 'P1', file: 'caller.js', line: 4, summary: 'broken by the new signature', causedByChange: true };

  // When
  const r = await run(args, (o) => (o.agentType === 'code-reviewer' ? { ...CLEAN, findings: [finding] } : undefined));

  // Then
  assert.deepEqual(r.out.openFindings, ['P1 caller.js:4 broken by the new signature']);
  assert.deepEqual(r.out.outside, []);
  assert.equal(fixers(r).length, 0);
  assert.equal(r.out.rounds, 1);
  assert.equal(r.out.status, 'failed');
});

test('given the reviewer prompt, when a review runs, then the perimeter sentence names causedByChange', async () => {
  // Given / When
  const { calls } = await run(base([task('a', ['a.js'])]));

  // Then
  assert.match(calls.find((c) => c.label === 'review round 1').prompt, /causedByChange/);
});

test('given a failed task and a stopped task, when the workflow ends, then filesChanged lists their files and a finding there still gets no fixer', async () => {
  // Given
  const args = base([task('a', ['a.js']), task('b', ['b.js']), task('c', ['c.js'])]);
  const handler = (o, p) => {
    if (o.label === 'implement b') return 'STOP: which?';
    if (o.agentType === 'gate-runner' && p.includes('verify-a')) return G(1, 'boom');
    return o.agentType === 'code-reviewer' ? { ...CLEAN, findings: [{ priority: 'P1', file: 'a.js', summary: 'x' }] } : undefined;
  };

  // When
  const r = await run(args, handler);

  // Then
  assert.deepEqual(r.out.filesChanged, ['a.js', 'b.js', 'c.js']);
  assert.equal(fixers(r).length, 0);
});

test('given a skipped task, when the workflow ends, then its files are not in filesChanged', async () => {
  // Given
  const args = base([task('a', ['a.js']), task('b', ['b.js'], { dependsOn: ['a'] })]);

  // When
  const { out } = await run(args, (o) => (o.label === 'implement a' ? 'STOP: which?' : undefined));

  // Then
  assert.deepEqual(out.filesChanged, ['a.js']);
});

test('given a task relaunched with red true, when it runs, then there is no tests-only step or red check and the implementer is told the tests are red', async () => {
  // Given
  const args = base([task('a', ['a.js'], { tdd: true, red: true })]);

  // When
  const { out, calls } = await run(args);

  // Then
  assert.deepEqual(calls.filter((c) => c.label.startsWith('red')), []);
  const p = calls.find((c) => c.label === 'implement a').prompt;
  assert.match(p, /written and red\. Make them pass/);
  assert.doesNotMatch(p, /undefined/);
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'done', red: true }]);
});

test('given a red that is not a boolean, when the workflow runs, then it returns an error and spawns nothing', async () => {
  // Given / When
  const { out, calls } = await run(base([task('a', ['a.js'], { red: 'yes' })]));

  // Then
  assert.equal(out.status, 'error');
  assert.equal(calls.length, 0);
});

const reviewOnce = (review) => { let round = 0; return (o) => (o.agentType === 'code-reviewer' && ++round === 1 ? { ...CLEAN, ...review } : undefined); };

test('given doneFiles from an earlier run, when a P1 lands in one of them, then it gets a fixer and not outside', async () => {
  // Given
  const args = base([task('b', ['b.js'], { dependsOn: ['a'] })], { done: ['a'], doneFiles: ['old.js'] });

  // When
  const r = await run(args, reviewOnce({ findings: [{ priority: 'P1', file: 'old.js', summary: 'bad' }] }));

  // Then
  assert.deepEqual(fixers(r).map((c) => c.label), ['fix old.js']);
  assert.deepEqual(tier(fixers(r)[0]), ['sonnet', 'medium']);
  assert.deepEqual(r.out.outside, []);
  assert.equal(r.out.status, 'ok');
});

test('given doneFiles that is not an array of non-empty strings, when the workflow runs, then it errors and spawns nothing', async () => {
  for (const doneFiles of ['a.js', [''], [3]]) {
    // Given / When
    const { out, calls } = await run(base([task('a', ['a.js'])], { doneFiles }));

    // Then
    assert.deepEqual(out.errors, ['doneFiles must be an array of path strings']);
    assert.equal(calls.length, 0);
  }
});

test('given doneFiles from an earlier run, when the run ends, then filesChanged carries them too', async () => {
  // Given
  const args = base([task('b', ['b.js'], { dependsOn: ['a'] })], { done: ['a'], doneFiles: ['./old.js'] });

  // When
  const { out } = await run(args);

  // Then
  assert.ok(out.filesChanged.includes('old.js'), JSON.stringify(out.filesChanged));
  assert.equal(new Set(out.filesChanged).size, out.filesChanged.length);
});

test('given a baseline that is not a boolean, when the workflow runs, then it errors and spawns nothing', async () => {
  for (const baseline of ['false', 0, null]) {
    // Given / When
    const { out, calls } = await run(base([task('a', ['a.js'])], { baseline }));

    // Then
    assert.equal(out.status, 'error');
    assert.deepEqual(out.errors, ['baseline must be a boolean']);
    assert.equal(calls.length, 0);
  }
});

test('given a green verify that ran no test, when the wave verifies, then the task fails with a clear line and no retry', async () => {
  // Given
  const handler = (o) => (o.label === 'verify a' ? G(0, 'Total tests: 0', true) : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'failed', red: false, line: 'the verify ran no test: Total tests: 0' }]);
  assert.ok(!calls.some((c) => c.label === 'retry a'));
  assert.equal(out.status, 'failed');
});

test('given a suite that exits 0 with no test run, when the workflow ends, then suite is not run with no test ran and status is not ok', async () => {
  // Given
  const handler = (o) => (o.label === 'suite' ? G(0, '# tests 0', true) : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.equal(out.suite, 'not run: no test ran: # tests 0');
  assert.ok(!calls.some((c) => c.label.startsWith('fix ')));
  assert.notEqual(out.status, 'ok');
});

test('given a suite red before any change, when the workflow runs, then it does no work and returns stop with the line', async () => {
  // Given
  const handler = (o) => (o.label === 'baseline' ? G(1, '# fail 3') : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.deepEqual(calls.map((c) => c.label), ['baseline']);
  assert.equal(out.status, 'stop');
  assert.deepEqual(out.stops, [{ id: 'baseline', question: 'the suite is red before any change: # fail 3 — fix it first or pass a narrower testCmd?' }]);
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'pending', red: false }]);
  assert.equal(out.suite, 'red: # fail 3');
});

test('given a baseline that did not run, when the workflow runs, then it does no work and the stop names the line', async () => {
  // Given
  const handler = (o) => (o.label === 'baseline' ? G(-1, 'killed') : undefined);

  // When
  const { out, calls } = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.equal(calls.length, 1);
  assert.deepEqual(out.stops, [{ id: 'baseline', question: 'the suite did not run before any change: killed — fix it first or pass a narrower testCmd?' }]);
});

test('given baseline false, when the workflow runs, then the suite is not run before the first wave', async () => {
  // Given / When
  const on = await run(base([task('a', ['a.js'])]));
  const off = await run(base([task('a', ['a.js'])], { baseline: false }));

  // Then
  assert.equal(on.events.indexOf('start baseline'), 0);
  assert.ok(!off.calls.some((c) => c.label === 'baseline'));
  assert.equal(off.out.status, 'ok');
});

test('given a red suite naming one declared file, when a fix round runs, then that file has the one suite fixer and the item is open once', async () => {
  // Given
  const handler = (o) => (o.label === 'suite' ? G(1, 'FAIL src/data.test.js > total') : o.agentType === 'code-reviewer' ? CLEAN : undefined);

  // When
  const r = await run(base([task('a', ['src/a.js', 'src/data.js', 'src/data.test.js', 'src/b.test.js'])]), handler);

  // Then
  assert.deepEqual([...new Set(fixers(r).map((c) => c.label))], ['fix src/data.test.js']);
  assert.equal(fixers(r).length, 2);
  assert.deepEqual(r.out.openFindings, ['the suite (suite-cmd) is red: FAIL src/data.test.js > total']);
});

test('given a red suite naming no inside file, when a fix round runs, then the first changed test file gets the fixer, else the first changed file', async () => {
  // Given
  const once = () => { let n = 0; return (o) => (o.label === 'suite' ? G(++n > 1 ? 0 : 1, '# fail 1') : undefined); };

  // When
  const withTest = await run(base([task('a', ['src/a.js', 'test/a.test.js', 'test/b.spec.js'])]), once());
  const noTest = await run(base([task('a', ['src/z.js', 'src/a.js'])]), once());

  // Then
  assert.deepEqual(fixers(withTest).map((c) => c.label), ['fix test/a.test.js']);
  assert.deepEqual(fixers(noTest).map((c) => c.label), ['fix src/z.js']);
});

test('given two tasks naming one file as ./src/x.js and SRC/x.js, when a wave runs, then their implementers run serially', async () => {
  // Given / When
  const { max } = await run(base([task('a', ['./src/x.js']), task('b', ['SRC/x.js'])]));

  // Then
  assert.equal(max.implementer, 1);
});

test('given findings on a declared file as a lower-case drive and a /c/ path, when reviewed, then one fixer runs on the declared path and nothing is outside', async () => {
  // Given
  const finding = (file) => ({ priority: 'P1', file, summary: 's' });

  // When
  const r = await run(base([task('a', ['src/a.js'])], { repoRoot: 'C:\\Repo' }), reviewOnce({ findings: [finding('c:/repo/src/a.js'), finding('/c/repo/src/a.js')] }));

  // Then
  assert.deepEqual(fixers(r).map((c) => c.label), ['fix src/a.js']);
  assert.deepEqual(r.out.outside, []);
});

test('given a fixer that answers STOP, when the reviewer repeats the finding, then the fixer is not relaunched and stops has one entry', async () => {
  // Given
  const handler = (o) => (o.label === 'fix a.js' ? 'STOP: which?' : o.agentType === 'code-reviewer' ? { ...CLEAN, findings: [{ priority: 'P1', file: 'a.js', summary: 'bad' }] } : undefined);

  // When
  const r = await run(base([task('a', ['a.js'])]), handler);

  // Then
  assert.equal(fixers(r).length, 1);
  assert.deepEqual(r.out.stops, [{ id: 'fix:a.js', question: 'which?' }]);
  assert.equal(r.out.status, 'stop');
});

test('given a stopped task, when a gap of that task or a finding on its file in other case comes back, then neither gets a fixer', async () => {
  // Given
  const handler = (o) => {
    if (o.label === 'implement b') return 'STOP: which?';
    return o.agentType === 'code-reviewer'
      ? { ...CLEAN, findings: [{ priority: 'P1', file: 'B.js', summary: 'x' }], criteriaMap: [{ task: 'b', criterion: 'c', gap: true, file: 'b2.test.js' }] }
      : undefined;
  };

  // When
  const r = await run(base([task('a', ['a.js']), task('b', ['b.js'])]), handler);

  // Then
  assert.equal(fixers(r).length, 0);
  assert.equal(r.out.openFindings.length, 2);
});

test('given task files written as ./a.js and a fix on .\\b.js, when the workflow ends, then filesChanged lists normalised paths once', async () => {
  // Given
  const args = base([task('a', ['./a.js']), task('b', ['b.js'])]);

  // When
  const { out } = await run(args, reviewOnce({ findings: [{ priority: 'P1', file: '.\\b.js', summary: 's' }] }));

  // Then
  assert.deepEqual(out.filesChanged, ['a.js', 'b.js']);
});

test('given a task relaunched with red true and a redLine, when it runs, then the brief quotes the line and the summary returns it', async () => {
  // Given
  const args = base([task('a', ['a.js'], { tdd: true, red: true, redLine: 'X fails' })]);

  // When
  const { out, calls } = await run(args);

  // Then
  assert.match(calls.find((c) => c.label === 'implement a').prompt, /written and red \(X fails\)/);
  assert.deepEqual(out.tasks, [{ id: 'a', state: 'done', red: true, redLine: 'X fails' }]);
});

test('given a redLine that is not a string, when the workflow runs, then it errors and spawns nothing', async () => {
  // Given / When
  const { out, calls } = await run(base([task('a', ['a.js'], { red: true, redLine: 5 })]));

  // Then
  assert.deepEqual(out.errors, ['tasks[0].redLine must be a string']);
  assert.equal(calls.length, 0);
});

test('given a suite with no test and doneFiles, when the baseline runs, then the stop names baseline: false and keeps doneFiles', async () => {
  // Given
  const args = base([task('a', ['a.js'])], { doneFiles: ['old.js'] });
  const handler = (o) => (o.label === 'baseline' ? { exitCode: 0, noTests: true, line: '# tests 0' } : undefined);

  // When
  const { out } = await run(args, handler);

  // Then
  assert.equal(out.status, 'stop');
  assert.match(out.stops[0].question, /relaunch with baseline: false\.$/);
  assert.deepEqual(out.filesChanged, ['old.js']);
});

test('given a criteria gap or a lost test on a file outside the change, when reviewed, then it stays open with no fixer, while a test file still gets one', async () => {
  // Given
  let round = 0;
  let testRound = 0;
  const handler = (o) => (o.agentType === 'code-reviewer' && ++round === 1
    ? { ...CLEAN, criteriaMap: [{ task: 'a', criterion: 'c1', gap: true, file: 'other/prod.js' }], lostTests: [{ file: 'lib/data.js', test: 'kept case' }] }
    : undefined);
  const testFileHandler = (o) => (o.agentType === 'code-reviewer' && ++testRound === 1
    ? { ...CLEAN, criteriaMap: [{ task: 'a', criterion: 'c1', gap: true, file: 'x/a.test.js' }] }
    : undefined);

  // When
  const outsideFile = await run(base([task('a', ['a.js'])]), handler);
  const testFile = await run(base([task('a', ['a.js'])]), testFileHandler);

  // Then
  assert.ok(!outsideFile.ofType('implementer').some((c) => c.label.startsWith('fix ')));
  assert.equal(outsideFile.out.openFindings.length, 2);
  assert.equal(outsideFile.out.status, 'failed');
  assert.ok(testFile.ofType('implementer').some((c) => c.label === 'fix x/a.test.js'));
});

test('given files a.js and b.test.js, when the suite fails on a line naming other/data.js, then a.js is not matched inside data.js and the test file gets the fixer', async () => {
  // Given
  const handler = (o) => (o.label === 'suite' ? G(1, 'FAIL other/data.js:3 boom') : undefined);

  // When
  const { ofType } = await run(base([task('a', ['a.js']), task('b', ['b.test.js'])], { baseline: false }), handler);

  // Then
  const fixes = ofType('implementer').filter((c) => c.label.startsWith('fix ')).map((c) => c.label);
  assert.ok(fixes.includes('fix b.test.js'), fixes.join());
  assert.ok(!fixes.includes('fix a.js'), fixes.join());
});

test('given a sensitive run, when a review round runs, then a second opus reviewer runs in parallel and a finding only it reports gets a fixer', async () => {
  // Given
  let round = 0;
  const handler = (o) => (o.label === 'review round 1 (axes)' && ++round ? { ...CLEAN, findings: [{ priority: 'P1', file: 'a.js', summary: 'leaks' }] } : undefined);

  // When
  const { out, ofType, events } = await run(base([task('a', ['a.js'])], { risk: ['security'] }), handler);

  // Then
  const second = ofType('code-reviewer').find((c) => c.label === 'review round 1 (axes)');
  assert.deepEqual([second.model, second.effort], ['opus', 'high']);
  assert.match(second.prompt, /security/);
  assert.ok(events.indexOf('start review round 1 (axes)') < events.indexOf('end review round 1'), events.join('\n'));
  assert.ok(ofType('implementer').some((c) => c.label === 'fix a.js'));
  assert.equal(out.status, 'ok');
});

test('given a non-sensitive run, when a review round runs, then exactly one reviewer is launched', async () => {
  // Given / When
  const { ofType } = await run(base([task('a', ['a.js'])], { risk: ['concurrency'] }));

  // Then
  assert.equal(ofType('code-reviewer').length, 1);
});

test('given a sensitive run whose second reviewer returns nothing, when it ends, then the run continues on the first and records it', async () => {
  // Given
  const handler = (o) => (o.label === 'review round 1 (axes)' ? null : undefined);

  // When
  const { out } = await run(base([task('a', ['a.js'], { risk: ['money'] })]), handler);

  // Then
  assert.equal(out.status, 'ok');
  assert.ok(out.outside.some((s) => /second reviewer returned nothing/.test(s)), out.outside.join());
});

const fixLabels = (r) => [...new Set(fixers(r).map((c) => c.label))];

test('given a sensitive run, when a review round runs, then the second prompt has the first perimeter line and a Return line limited to the axes', async () => {
  // Given / When
  const { ofType } = await run(base([task('a', ['a.js'], { risk: ['security'] })]));

  // Then
  const [first, second] = ['review round 1', 'review round 1 (axes)'].map((l) => ofType('code-reviewer').find((c) => c.label === l).prompt);
  const perimeter = first.split('\n\n').find((p) => p.startsWith('Perimeter:'));
  assert.ok(perimeter);
  assert.ok(second.split('\n\n').includes(perimeter));
  assert.match(second, /Return: findings \(priority P1\|P2\|P3, file, line, summary, causedByChange\) limited to the sensitive axes; outside \(strings\); criteriaMap and lostTests empty/);
});

test('given both reviewers on the same file and line worded differently, when merged, then one item stays with the higher priority and the first summary', async () => {
  // Given
  const at = (priority, summary) => ({ ...CLEAN, findings: [{ priority, file: 'a.js', line: 3, summary }] });
  const handler = (o) => (o.label === 'review round 1' ? at('P2', 'first wording') : o.label === 'review round 1 (axes)' ? at('P1', 'other words') : undefined);

  // When
  const r = await run(base([task('a', ['a.js'], { risk: ['security'] })]), handler);

  // Then
  const prompt = fixers(r)[0].prompt;
  assert.equal(fixers(r).length, 1);
  assert.equal(prompt.split('\n').filter((l) => l.startsWith('- P')).length, 1, prompt);
  assert.match(prompt, /- P1 a\.js:3 first wording/);
});

test('given input risk security and the only done task risk concurrency, when a review runs, then exactly one reviewer is launched', async () => {
  // Given / When
  const { ofType } = await run(base([task('a', ['a.js'], { risk: ['concurrency'] })], { risk: ['security'] }));

  // Then
  assert.equal(ofType('code-reviewer').length, 1);
});

test('given a line naming /repo/src/a.js, when the suite is red, then src/a.js is matched and gets the fixer', async () => {
  // Given
  const handler = (o) => (o.label === 'suite' ? G(1, 'FAIL /repo/src/a.js:3 boom') : undefined);

  // When
  const r = await run(base([task('a', ['b.js', 'src/a.js'])], { baseline: false }), handler);

  // Then
  assert.deepEqual(fixLabels(r), ['fix src/a.js']);
});

test('given a line naming a.js.map, when the suite is red, then a.js is not matched', async () => {
  // Given
  const handler = (o) => (o.label === 'suite' ? G(1, 'FAIL a.js.map:3 boom') : undefined);

  // When
  const r = await run(base([task('a', ['b.js', 'a.js', 'c.test.js'])], { baseline: false }), handler);

  // Then
  assert.deepEqual(fixLabels(r), ['fix c.test.js']);
});

test('given candidates a.js and src/a.js, when the line names src/a.js, then the longer one wins', async () => {
  // Given
  const handler = (o) => (o.label === 'suite' ? G(1, 'FAIL src/a.js:3 boom') : undefined);

  // When
  const r = await run(base([task('a', ['a.js', 'src/a.js'])], { baseline: false }), handler);

  // Then
  assert.deepEqual(fixLabels(r), ['fix src/a.js']);
});

test('given outside items from both reviewers, when merged, then the summary has the union', async () => {
  // Given
  const handler = (o) => (o.label === 'review round 1' ? { ...CLEAN, outside: ['x.js:1 — one'] } : o.label === 'review round 1 (axes)' ? { ...CLEAN, outside: ['y.js:2 — two'] } : undefined);

  // When
  const { out } = await run(base([task('a', ['a.js'], { risk: ['security'] })]), handler);

  // Then
  assert.deepEqual(out.outside, ['x.js:1 — one', 'y.js:2 — two']);
});

test('given the first reviewer returns nothing while the second answers, when the round ends, then it is open and the run is not ok', async () => {
  // Given
  const handler = (o) => (o.label === 'review round 1' ? null : o.label === 'review round 1 (axes)' ? CLEAN : undefined);

  // When
  const { out } = await run(base([task('a', ['a.js'], { risk: ['security'] })]), handler);

  // Then
  assert.deepEqual(out.openFindings, ['reviewer round 1 returned nothing: the change is not reviewed']);
  assert.notEqual(out.status, 'ok');
});
