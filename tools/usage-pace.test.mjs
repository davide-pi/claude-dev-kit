#!/usr/bin/env node
/**
 * Tests for hooks/lib/usage-pace.js, in-process. Zero dependencies, `node:test` on Node 18+.
 *
 *   node --test "tools/*.test.mjs"
 *
 * Contract used here: plan(input, { now, pace, configDir }) returns { json } (hook output), { text } (PreCompact
 * stdout) or null; pace is the shared-file shape of statusline/pace.js. Each case has its own config dir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, utimesSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { plan, claim } = createRequire(import.meta.url)(join(ROOT, 'hooks', 'lib', 'usage-pace.js'));

const NOW = Date.now(); // markers carry real file times, so the pruning age needs a real clock
const MIN = 60_000;
const R5 = NOW + 2 * 3600_000;
const R7 = NOW + 3 * 86_400_000;
const SID = 'abcd1234-0000-4000-8000-000000000001';
const dirs = [];
process.on('exit', () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const world = () => { const d = mkdtempSync(join(tmpdir(), 'usage-pace-lib-')); dirs.push(d); return d; };
const pace = (p5, p7 = 10, over = {}) => ({
  v: 1, updatedAt: NOW - MIN, five_hour: { pct: p5, resetsAt: R5 }, seven_day: { pct: p7, resetsAt: R7 },
  samples5h: [], samples7d: [], ...over,
});
const ctx = (configDir, p, now = NOW) => ({ now, pace: p, configDir });
const pre = (tool, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: tool, tool_input: {}, ...extra });
const text = (out) => out && out.json.hookSpecificOutput.additionalContext;

test('Given 69% on both windows, When a tool runs, Then nothing is printed', () => {
  // Given
  const dir = world();
  // When
  const out = plan(pre('Bash'), ctx(dir, pace(69)));
  // Then
  assert.equal(out, null);
});

test('Given 70% and 85%, When the same chat runs two tools, Then each band is told once', () => {
  // Given
  const dir = world();
  // When
  const a = plan(pre('Bash'), ctx(dir, pace(71)));
  const b = plan(pre('Bash'), ctx(dir, pace(72)));
  const c = plan(pre('Bash'), ctx(dir, pace(86)));
  // Then
  assert.match(text(a), /5h window at 71%/);
  assert.equal(b, null);
  assert.match(text(c), /fewer agents/);
});

test('Given a jump to 92%, When a tool runs, Then only the 92 notice comes and 70 and 85 stay silent after', () => {
  // Given
  const dir = world();
  // When
  const a = plan(pre('Bash'), ctx(dir, pace(93)));
  const b = plan(pre('Bash'), ctx(dir, pace(93.5)));
  // Then
  assert.match(text(a), /no new Workflow/);
  assert.doesNotMatch(text(a), /fewer agents/);
  assert.equal(b, null);
});

test('Given a jump from below 70% to 96% or 98%, When a tool runs, Then the notice arms the resume first', () => {
  // Given
  const at96 = world(), at98 = world(), sub = world();
  // When
  const a = plan(pre('Bash'), ctx(at96, pace(96.5)));
  const b = plan(pre('Bash'), ctx(at98, pace(98.5)));
  const c = plan(pre('Bash', { agent_id: 'ag1', agent_type: 'implementer' }), ctx(sub, pace(98.5)));
  // Then
  assert.match(text(a), /--arm --session/);
  assert.match(text(a), /--ready --session/);
  assert.match(text(b), /--arm --session/);
  assert.match(text(b), /--ready --session/);
  assert.match(text(b), /Close the step in hand/);
  assert.doesNotMatch(text(c), /--arm/);
});

test('Given 92% told at 93%, When the next tool sees 98.5%, Then the 98 notice carries the 96 actions first', () => {
  // Given
  const dir = world();
  plan(pre('Bash'), ctx(dir, pace(93)));
  // When
  const out = plan(pre('Bash'), ctx(dir, pace(98.5)));
  // Then
  assert.match(text(out), /Update the checkpoint file/);
  assert.match(text(out), /--ready --session/);
  assert.doesNotMatch(text(out), /--arm --session/);
  assert.match(text(out), /Close the step in hand/);
});

test('Given the 92 and 96 notices, When they are told, Then each says how to disarm when the work ends first', () => {
  // Given
  const at92 = world(), at96 = world();
  // When
  const a = text(plan(pre('Bash'), ctx(at92, pace(93))));
  const b = text(plan(pre('Bash'), ctx(at96, pace(96.5))));
  // Then
  for (const t of [a, b]) {
    assert.match(t, /--done --session/);
    assert.match(t, /CronDelete/);
  }
});

test('Given the 92, 96 and 98 notices and a resume, When they are told, Then none asks for a Windows scheduled task', () => {
  // Given: the owner wants no Windows tasks; a closed chat stays closed with its checkpoint on disk
  const dirs3 = [world(), world(), world()];
  const armedDir = world();
  mkdirSync(join(armedDir, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(armedDir, '.cache', 'pace', `${SID}.json`), JSON.stringify({ v: 1, sessionId: SID, checkpoint: '/x/resume.md', ready: true }));
  // When
  const told = [93, 96.5, 98.5].map((p, i) => text(plan(pre('Bash'), ctx(dirs3[i], pace(p)))));
  told.push(text(plan({ hook_event_name: 'SessionStart', session_id: SID, source: 'resume' }, ctx(armedDir, null))));
  // Then
  for (const t of told) assert.doesNotMatch(t, /resume-task|resume task|scheduled task|Windows task/i);
});

test('Given 92%, When a tool runs, Then the notice leaves the CronCreate choice to 96, where the mod has had time to beat', () => {
  // Given: no mod beat yet, as right after --arm
  const none = world();
  // When
  const t = text(plan(pre('Bash'), ctx(none, pace(93))));
  // Then
  assert.doesNotMatch(t, /CronCreate a one-shot/);
});

test('Given 96% and a live mod, When a tool runs, Then the notice drops any resume prompt; with no mod it asks for one', () => {
  // Given
  const live = world(), none = world();
  mkdirSync(join(live, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(live, '.cache', 'pace', `${SID}.mod.json`), JSON.stringify({ v: 1, aliveAt: NOW - MIN }));
  // When
  const a = text(plan(pre('Bash'), ctx(live, pace(96.5))));
  const b = text(plan(pre('Bash'), ctx(none, pace(96.5))));
  // Then
  assert.match(a, /CronDelete a resume prompt you created and create none/);
  assert.doesNotMatch(a, /CronCreate a one-shot/);
  assert.match(b, /CronCreate a one-shot/);
});

test('Given 96% with and without a live mod, When a tool runs, Then it names the mod or asks for /compact', () => {
  // Given
  const live = world(), none = world();
  mkdirSync(join(live, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(live, '.cache', 'pace', `${SID}.mod.json`), JSON.stringify({ v: 1, aliveAt: NOW - 2 * MIN }));
  // When
  const a = plan(pre('Bash'), ctx(live, pace(96.5)));
  const b = plan(pre('Bash'), ctx(none, pace(96.5)));
  // Then
  assert.match(text(a), /mod compacts after your turn/);
  assert.match(text(b), /run \/compact/);
});

test('Given a mod that stopped 4 minutes ago, When 96% is told, Then it counts as absent', () => {
  // Given
  const dir = world();
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(dir, '.cache', 'pace', `${SID}.mod.json`), JSON.stringify({ v: 1, aliveAt: NOW - 4 * MIN }));
  // When
  const out = plan(pre('Bash'), ctx(dir, pace(97)));
  // Then
  assert.match(text(out), /run \/compact/);
});

test('Given a subagent, When 92% and 96% are crossed, Then it hears only the 85 advice, then nothing new; at 98% it is told to close its step', () => {
  // Given
  const dir = world();
  const sub = pre('Bash', { agent_id: 'ag1', agent_type: 'implementer' });
  // When
  const at92 = plan(sub, ctx(dir, pace(93)));
  const at96 = plan(sub, ctx(dir, pace(97)));
  const at98 = plan(sub, ctx(dir, pace(98.5)));
  // Then
  assert.match(text(at92), /fewer agents/);
  assert.equal(at96, null);
  assert.match(text(at98), /Close your step now and report your state/);
});

test('Given a subagent and the main loop, When both cross 85%, Then each is told once (own marker)', () => {
  // Given
  const dir = world();
  // When
  const main = plan(pre('Bash'), ctx(dir, pace(86)));
  const sub = plan(pre('Bash', { agent_id: 'ag1' }), ctx(dir, pace(86)));
  // Then
  assert.ok(main);
  assert.ok(sub);
  assert.equal(readdirSync(join(dir, '.cache', 'pace-notices')).length, 4);
});

test('Given 92% fresh data, When the main loop starts a Workflow, Then it is denied unless its input carries an override', () => {
  // Given
  const dir = world();
  const p = pace(93);
  const call = (tool_input, extra = {}) => plan(pre('Workflow', { tool_input, ...extra }), ctx(dir, p));
  // When
  const plain = call({ prompt: 'review the diff' });
  const quoted = call({ prompt: 'the owner asked for a review of the diff' });
  const asked = call({ prompt: 'review it, pace: owner asked' });
  const finish = call({ prompt: 'Pace: Finish the open step' });
  const inside = call({ prompt: 'x' }, { agent_id: 'ag1' });
  // Then
  assert.equal(plain.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(quoted.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(asked?.json.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(finish?.json.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(inside?.json.hookSpecificOutput.permissionDecision, undefined);
});

test('Given the 7d window at 93%, When a Workflow starts, Then it is denied too', () => {
  // Given
  const dir = world();
  // When
  const out = plan(pre('Workflow', { tool_input: { args: { brief: 'x' } } }), ctx(dir, pace(10, 93)));
  // Then
  assert.equal(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /7d window is at 93%/);
});

test('Given data older than 10 minutes or a window past its reset, When a Workflow starts, Then the brake is lifted', () => {
  // Given
  const dir = world();
  const stale = pace(95, 10, { updatedAt: NOW - 11 * MIN });
  // When
  const old = plan(pre('Workflow'), ctx(dir, stale));
  const reset = plan(pre('Workflow'), ctx(world(), pace(95, 10, { updatedAt: R5 }), R5 + MIN));
  // Then
  assert.equal(old, null);
  assert.ok(reset === null || reset.json.hookSpecificOutput.permissionDecision === undefined);
  assert.equal(plan(pre('Workflow'), ctx(world(), pace(95, 10, { updatedAt: R5 }), R5 - MIN)).json.hookSpecificOutput.permissionDecision, 'deny');
});

test('Given an unrelated tool at 95%, When it runs, Then it is never denied', () => {
  // Given
  const dir = world();
  // When
  const out = plan(pre('Bash'), ctx(dir, pace(95)));
  // Then
  assert.equal(out.json.hookSpecificOutput.permissionDecision, undefined);
});

test('Given UserPromptSubmit and PreToolUse in one chat, When both fire at 70%, Then the band is told only once', () => {
  // Given
  const dir = world();
  const prompt = { hook_event_name: 'UserPromptSubmit', session_id: SID };
  // When
  const a = plan(prompt, ctx(dir, pace(75)));
  const b = plan(pre('Bash'), ctx(dir, pace(75)));
  // Then
  assert.equal(a.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(b, null);
});

test('Given a new reset of the window, When the same band is crossed again, Then it is told again', () => {
  // Given
  const dir = world();
  const next = pace(75);
  next.five_hour.resetsAt = R5 + 5 * 3600_000;
  // When
  const a = plan(pre('Bash'), ctx(dir, pace(75)));
  const b = plan(pre('Bash'), ctx(dir, next));
  // Then
  assert.ok(a);
  assert.ok(b);
});

test('Given a marker older than 7 days, When another band is claimed, Then the old marker is pruned', () => {
  // Given
  const dir = world();
  const notices = join(dir, '.cache', 'pace-notices');
  mkdirSync(notices, { recursive: true });
  const old = join(notices, 'old');
  writeFileSync(old, '');
  const past = new Date(Date.now() - 8 * 86_400_000);
  utimesSync(old, past, past);
  // When
  const first = claim(dir, SID, 'main', 'five_hour', R5, 70, Date.now());
  const again = claim(dir, SID, 'main', 'five_hour', R5, 70, Date.now());
  // Then
  assert.equal(first, true);
  assert.equal(again, false);
  assert.equal(readdirSync(notices).includes('old'), false);
});

test('Given an armed chat, When SessionStart resumes or compacts, Then the checkpoint path and the verify-first order are given', () => {
  // Given
  const dir = world();
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(dir, '.cache', 'pace', `${SID}.json`), JSON.stringify({ v: 1, sessionId: SID, checkpoint: '/x/resume.md', ready: true }));
  const start = (source) => plan({ hook_event_name: 'SessionStart', session_id: SID, source }, ctx(dir, null));
  // When
  const resumed = start('resume'), compacted = start('compact'), fresh = start('startup');
  // Then
  assert.match(text(resumed), /checkpoint: \/x\/resume\.md/);
  assert.match(text(resumed), /verify the real state/);
  assert.ok(compacted);
  assert.equal(fresh, null);
});

test('Given a pace file armed for a resume a day ago, When the closed chat is resumed by hand, Then the checkpoint is still named', () => {
  // Given
  const dir = world();
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(dir, '.cache', 'pace', `${SID}.json`), JSON.stringify({ checkpoint: '/x/resume.md', resumeAt: NOW - 24 * 3600_000 }));
  // When
  const out = plan({ hook_event_name: 'SessionStart', session_id: SID, source: 'resume' }, ctx(dir, null));
  // Then
  assert.match(text(out), /checkpoint: \/x\/resume\.md/);
});

test('Given a done chat, When SessionStart resumes, Then nothing is printed', () => {
  // Given
  const dir = world();
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(dir, '.cache', 'pace', `${SID}.json`), JSON.stringify({ checkpoint: '/x/resume.md', done: true }));
  // When
  const out = plan({ hook_event_name: 'SessionStart', session_id: SID, source: 'resume' }, ctx(dir, null));
  // Then
  assert.equal(out, null);
});

test('Given an armed chat with a checkpoint, When PreCompact fires, Then stdout starts with the path and carries its first lines', () => {
  // Given
  const dir = world();
  const checkpoint = join(dir, 'resume.md');
  writeFileSync(checkpoint, 'Goal: ship\nNext: gate\n');
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(dir, '.cache', 'pace', `${SID}.json`), JSON.stringify({ checkpoint }));
  // When
  const out = plan({ hook_event_name: 'PreCompact', session_id: SID, trigger: 'manual' }, ctx(dir, null));
  // Then
  assert.ok(out.text.includes(`summary, it is the usage-pace checkpoint: ${checkpoint}\nGoal: ship\nNext: gate`));
  assert.equal(plan({ hook_event_name: 'PreCompact', session_id: 'other' }, ctx(dir, null)), null);
});

test('Given 93% fresh data, When the main loop starts one Agent or Task, Then it is not denied and the 92 notice asks for one subagent at a time and no critical operation', () => {
  // Given
  const dir = world();
  // When
  const agent = plan(pre('Agent', { tool_input: { prompt: 'x' } }), ctx(dir, pace(93)));
  const task = plan(pre('Task', { tool_input: { prompt: 'x' } }), ctx(world(), pace(93)));
  // Then
  assert.notEqual(agent?.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.notEqual(task?.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(text(agent), /one subagent at a time/);
  assert.match(text(agent), /no critical operation/);
});

test('Given 86%, When the 85 notice is told, Then it asks for fewer parallel agents or a slower pace and keeps the models', () => {
  // Given
  const dir = world();
  // When
  const out = text(plan(pre('Bash'), ctx(dir, pace(86))));
  // Then
  assert.match(out, /fewer agents in parallel, or slow down/);
  assert.match(out, /keep the same models/);
  assert.doesNotMatch(out, /smaller models/);
});

test('Given a burn rate from the samples, When any band is told, Then the notice carries the burn and the estimated time of each next band', () => {
  // Given
  const samples = (to) => [{ t: NOW - 20 * MIN, pct: to - 4 }, { t: NOW - 10 * MIN, pct: to - 2 }, { t: NOW - MIN, pct: to }];
  const at = (pct) => text(plan(pre('Bash'), ctx(world(), pace(pct, 10, { samples5h: samples(pct) }))));
  // When
  const n70 = at(71), n92 = at(93), n96 = at(97);
  // Then
  assert.match(n70, /burning \d+\.\d%\/h/);
  assert.match(n70, /next: 85% ~\d\d:\d\d, 92% ~\d\d:\d\d, 96% ~\d\d:\d\d\./);
  assert.doesNotMatch(n70, /98% ~/); // at this rate 98% comes after the reset, so it is left out
  assert.match(n92, /burning .*next: 96% ~\d\d:\d\d, 98% ~/);
  assert.match(n96, /burning .*next: 98% ~/);
});
