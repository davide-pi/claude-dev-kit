#!/usr/bin/env node
/**
 * Tests for hooks/lib/usage-pace.js, in-process. Zero dependencies, `node:test` on Node 18+.
 *
 *   node --test "tools/*.test.mjs"
 *
 * Contract used here: plan(input, { now, pace, configDir }) returns { json } (hook output), { text } (PreCompact
 * stdout) or null; pace is the shared-file shape of statusline/pace.js. Each case has its own config dir.
 * Bands: 5h 70/85/92/96/98, 7d 70/85/92/96/98/99; a conditional band slows the chat only when the window is short
 * (at the current burn it runs out before its reset; an unknown burn is not short).
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
const STOP = /stop: compact, save state, wait for the cron/i;
const dirs = [];
process.on('exit', () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const world = () => { const d = mkdtempSync(join(tmpdir(), 'usage-pace-lib-')); dirs.push(d); return d; };
const pace = (p5, p7 = 10, over = {}) => ({
  v: 1, updatedAt: NOW - MIN, five_hour: { pct: p5, resetsAt: R5 }, seven_day: { pct: p7, resetsAt: R7 },
  samples5h: [], samples7d: [], ...over,
});
// Three samples over 20 min ending a minute ago, rising at `burn` %/h. 5h resets in 2 h, 7d in 72 h.
const rising = (pct, burn) => [{ t: NOW - 21 * MIN, pct: pct - burn / 3 }, { t: NOW - 11 * MIN, pct: pct - burn / 6 }, { t: NOW - MIN, pct }];
const five = (pct, burn) => pace(pct, 10, { samples5h: rising(pct, burn) });
const seven = (pct, burn) => pace(10, pct, { samples7d: rising(pct, burn) });
const ctx = (configDir, p, now = NOW) => ({ now, pace: p, configDir });
const pre = (tool, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: tool, tool_input: {}, ...extra });
const text = (out) => out && out.json.hookSpecificOutput.additionalContext;
const decision = (out) => out?.json.hookSpecificOutput.permissionDecision;

test('Given 69% on both windows, When a tool runs, Then nothing is printed', () => {
  // Given
  const dir = world();
  // When
  const out = plan(pre('Bash'), ctx(dir, pace(69)));
  // Then
  assert.equal(out, null);
});

test('Given the 7d window at 71%, When a tool runs, Then nothing is printed (7d has no 70 notice)', () => {
  // Given
  const dir = world();
  // When
  const out = plan(pre('Bash'), ctx(dir, pace(10, 71)));
  // Then
  assert.equal(out, null);
});

test('Given 70% and 85%, When the same chat runs two tools, Then each band is told once', () => {
  // Given
  const dir = world();
  // When
  const a = plan(pre('Bash'), ctx(dir, pace(71)));
  const b = plan(pre('Bash'), ctx(dir, pace(72)));
  const c = plan(pre('Bash'), ctx(dir, five(86, 10)));
  // Then
  assert.match(text(a), /5h window at 71%/);
  assert.equal(b, null);
  assert.match(text(c), /fewer agents/);
});

test('Given 5h at 85% short and not short, When the notice is due, Then short says fewer agents in parallel and not short is a notice line only', () => {
  // Given: short = 14 % left at 10 %/h runs out in 1.4 h, the reset is in 2 h; 1 %/h reaches the reset
  const short = world(), calm = world();
  // When
  const a = text(plan(pre('Bash'), ctx(short, five(86, 10))));
  const b = text(plan(pre('Bash'), ctx(calm, five(86, 1))));
  const unknown = text(plan(pre('Bash'), ctx(world(), pace(86))));
  // Then
  assert.match(a, /fewer agents in parallel/);
  assert.match(b, /5h window at 86%/);
  assert.doesNotMatch(b, /fewer agents|no new Workflow|--arm/);
  assert.doesNotMatch(unknown, /fewer agents|no new Workflow|--arm/);
});

test('Given a jump to 92% short, When a tool runs, Then only the 92 notice comes and 70 and 85 stay silent after', () => {
  // Given
  const dir = world();
  // When
  const a = plan(pre('Bash'), ctx(dir, five(93, 10)));
  const b = plan(pre('Bash'), ctx(dir, five(93.5, 10)));
  // Then
  assert.match(text(a), /no new Workflow/);
  assert.doesNotMatch(text(a), /fewer agents/);
  assert.equal(b, null);
});

test('Given 5h at 93% not short, When the burn rises and the window becomes short, Then the brake text with the arm is sent once', () => {
  // Given
  const dir = world();
  const calm = plan(pre('Bash'), ctx(dir, five(93, 1)));
  // When
  const a = text(plan(pre('Bash'), ctx(dir, five(93, 10))));
  const b = plan(pre('Bash'), ctx(dir, five(93, 10)));
  const back = plan(pre('Bash'), ctx(dir, five(93, 1)));
  // Then
  assert.doesNotMatch(text(calm), /--arm/);
  assert.match(a, /no new Workflow/);
  assert.match(a, /--arm/);
  assert.equal(b, null);
  assert.equal(back, null);
});

test('Given 5h at 92% not short, When a tool runs, Then it is a notice line only and a Workflow is not denied', () => {
  // Given
  const dir = world();
  // When
  const a = text(plan(pre('Bash'), ctx(dir, five(93, 1))));
  const flow = plan(pre('Workflow', { tool_input: { prompt: 'x' } }), ctx(dir, five(93, 1)));
  // Then
  assert.match(a, /5h window at 93%/);
  assert.doesNotMatch(a, /no new Workflow|one subagent at a time|--arm/);
  assert.notEqual(decision(flow), 'deny');
});

test('Given 7d at 92% with a burn that reaches the reset, When a notice is due, Then it is a notice line only and no brake applies', () => {
  // Given: 8 % left at 0.05 %/h lasts 160 h, the reset is in 72 h
  const dir = world();
  const p = seven(92, 0.05);
  // When
  const notice = text(plan(pre('Bash'), ctx(dir, p)));
  const flow = plan(pre('Workflow', { tool_input: { prompt: 'x' } }), ctx(world(), p));
  // Then
  assert.match(notice, /7d window at 92%/);
  assert.doesNotMatch(notice, /fewer agents|no new Workflow|--arm/);
  assert.notEqual(decision(flow), 'deny');
});

test('Given 7d at 85% and 92% short, When the notices are due, Then 85 is a notice with the burn and 92 asks for fewer agents', () => {
  // Given
  const at85 = world(), at92 = world();
  // When
  const a = text(plan(pre('Bash'), ctx(at85, seven(86, 0.5))));
  const b = text(plan(pre('Bash'), ctx(at92, seven(93, 0.5))));
  // Then
  assert.match(a, /7d window at 86%.*burning 0\.5%\/h/);
  assert.doesNotMatch(a, /fewer agents/);
  assert.match(b, /fewer agents in parallel/);
  assert.doesNotMatch(b, /--arm|no new Workflow/);
});

test('Given 7d at 96% with a burn that runs out before the reset, When the hook runs, Then it tells to arm the resume and brake() denies a new Workflow', () => {
  // Given: 4 % left at 0.5 %/h lasts 8 h, the reset is in 72 h
  const dir = world();
  const p = seven(96.5, 0.5);
  // When
  const notice = text(plan(pre('Bash'), ctx(dir, p)));
  const flow = plan(pre('Workflow', { tool_input: { prompt: 'review' } }), ctx(dir, p));
  // Then
  assert.match(notice, /--arm --session/);
  assert.match(notice, /CronCreate a one-shot/);
  assert.equal(decision(flow), 'deny');
  assert.match(flow.json.hookSpecificOutput.permissionDecisionReason, /7d window is at 96\.5%/);
});

test('Given 7d at 96% not short, When the hook runs, Then it is a notice line only and a Workflow is not denied', () => {
  // Given
  const dir = world();
  const p = seven(96.5, 0.01);
  // When
  const notice = text(plan(pre('Bash'), ctx(dir, p)));
  const flow = plan(pre('Workflow', { tool_input: { prompt: 'x' } }), ctx(dir, p));
  // Then
  assert.doesNotMatch(notice, /--arm|Update the checkpoint/);
  assert.notEqual(decision(flow), 'deny');
});

test('Given 7d at 98%, When the hook runs, Then it always tells to update the checkpoint and close the step, without the stop', () => {
  // Given
  const dir = world();
  // When
  const out = text(plan(pre('Bash'), ctx(dir, pace(10, 98.5))));
  // Then
  assert.match(out, /Update the checkpoint/);
  assert.match(out, /Close the step in hand/);
  assert.doesNotMatch(out, STOP);
});

test('Given 7d at 99% or 5h at 98%, When the hook runs, Then the text says stop: compact, save state, wait for the cron', () => {
  // Given
  const d7 = world(), d5 = world();
  // When
  const a = text(plan(pre('Bash'), ctx(d7, pace(10, 99.5))));
  const b = text(plan(pre('Bash'), ctx(d5, pace(98.5))));
  // Then
  assert.match(a, STOP);
  assert.match(b, STOP);
});

test('Given a runway under 30 min on 5h, When the hook runs at 80%, Then the closing actions are told before the band', () => {
  // Given: 20 % left at 50 %/h lasts 24 min
  const dir = world();
  // When
  const out = text(plan(pre('Bash'), ctx(dir, five(80, 50))));
  // Then
  assert.match(out, /--arm --session/);
  assert.match(out, /Update the checkpoint/);
  assert.doesNotMatch(out, STOP);
});

test('Given a runway under 2 h on 7d, When the hook runs at 80%, Then the closing actions are told before the band', () => {
  // Given: 20 % left at 50 %/h lasts 24 min
  const dir = world();
  // When
  const out = text(plan(pre('Bash'), ctx(dir, seven(80, 50))));
  // Then
  assert.match(out, /--arm --session/);
  assert.match(out, /Update the checkpoint/);
  assert.doesNotMatch(out, STOP);
});

test('Given a runway over 30 min on 5h, When the hook runs at 80%, Then it is a notice line only', () => {
  // Given: 20 % left at 10 %/h lasts 2 h, the reset is in 2 h
  const dir = world();
  // When
  const out = text(plan(pre('Bash'), ctx(dir, five(80, 10))));
  // Then
  assert.match(out, /5h window at 80%/);
  assert.doesNotMatch(out, /--arm|Update the checkpoint/);
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
  assert.match(text(b), STOP);
  assert.doesNotMatch(text(c), /--arm/);
});

const armChat = (dir, window, resetsAt) => {
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(dir, '.cache', 'pace', `${SID}.json`), JSON.stringify({ v: 1, sessionId: SID, window, resetsAt, checkpoint: '/x/resume.md' }));
};

test('Given the close told at 96.5% flat, When the window turns short, Then the lower 85 and 92 short bands are not told after it', () => {
  // Given
  const dir = world();
  plan(pre('Bash'), ctx(dir, five(96.5, 0)));
  // When: 97%, 5%/h, 36 min of runway against a reset in 2 h
  const out = plan(pre('Bash'), ctx(dir, five(97, 5)));
  // Then
  assert.equal(out, null);
});

test('Given the stop told at 98% flat, When the window turns short, Then no lower brake text arrives after it', () => {
  // Given
  const dir = world();
  plan(pre('Bash'), ctx(dir, five(98, 0)));
  // When
  const out = plan(pre('Bash'), ctx(dir, five(98, 5)));
  // Then
  assert.equal(out, null);
});

test('Given an armed 5h chat that finished with --done, When the same reset reaches the stop, Then the stop text arms again', () => {
  // Given
  const dir = world();
  armChat(dir, 'five_hour', R5);
  plan(pre('Bash'), ctx(dir, five(92.5, 10)));
  rmSync(join(dir, '.cache', 'pace', `${SID}.json`));
  // When
  const out = plan(pre('Bash'), ctx(dir, five(98.5, 10)));
  // Then
  assert.match(text(out), /--arm --session/);
  assert.match(text(out), STOP);
});

test('Given a chat armed on the 7d window with the later reset, When the 5h reaches its close, Then it is not told to arm again', () => {
  // Given
  const dir = world();
  armChat(dir, 'seven_day', R7);
  // When
  const out = plan(pre('Bash'), ctx(dir, pace(96.5, 98.5)));
  // Then
  assert.doesNotMatch(text(out), /--arm --session/);
  assert.match(text(out), /--ready --session/);
});

test('Given a chat armed on the 7d window that no longer needs arming, When the 5h reaches its close, Then it is told to arm', () => {
  // Given
  const dir = world();
  armChat(dir, 'seven_day', R7);
  // When
  const out = plan(pre('Bash'), ctx(dir, pace(96.5)));
  // Then
  assert.match(text(out), /Not armed yet/);
  assert.match(text(out), /--arm --session/);
});

test('Given 92% short told at 93%, When the next tool sees 98.5%, Then the 98 notice carries the 96 actions first', () => {
  // Given
  const dir = world();
  plan(pre('Bash'), ctx(dir, five(93, 10)));
  armChat(dir, 'five_hour', R5);
  // When
  const out = plan(pre('Bash'), ctx(dir, five(98.5, 10)));
  // Then
  assert.match(text(out), /Update the checkpoint/);
  assert.match(text(out), /--ready --session/);
  assert.doesNotMatch(text(out), /--arm --session/);
  assert.match(text(out), STOP);
});

test('Given the 92 and 96 notices, When they are told, Then each says how to disarm when the work ends first', () => {
  // Given
  const at92 = world(), at96 = world();
  // When
  const a = text(plan(pre('Bash'), ctx(at92, five(93, 10))));
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
  const told = [five(93, 10), pace(96.5), pace(98.5)].map((p, i) => text(plan(pre('Bash'), ctx(dirs3[i], p))));
  told.push(text(plan({ hook_event_name: 'SessionStart', session_id: SID, source: 'resume' }, ctx(armedDir, null))));
  // Then
  for (const t of told) assert.doesNotMatch(t, /resume-task|resume task|scheduled task|Windows task/i);
});

test('Given 92% short, When a tool runs with no mod, Then the arm notice says to CronCreate the one-shot at resumeAt with the prompt= line', () => {
  // Given: no mod beat yet
  const none = world();
  // When
  const t = text(plan(pre('Bash'), ctx(none, five(93, 10))));
  // Then
  assert.match(t, /CronCreate a one-shot prompt at resumeAt/);
  assert.match(t, /prompt=/);
});

test('Given the cockpit alive, When the arm notice is told, Then it still says to CronCreate the one-shot at resumeAt', () => {
  // Given
  const live = world();
  mkdirSync(join(live, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(live, '.cache', 'pace', `${SID}.mod.json`), JSON.stringify({ v: 1, aliveAt: NOW - MIN }));
  // When
  const at92 = text(plan(pre('Bash'), ctx(live, five(93, 10))));
  const at98 = text(plan(pre('Bash', { session_id: 'other-chat' }), ctx(live, pace(98.5))));
  // Then
  assert.match(at92, /CronCreate a one-shot prompt at resumeAt/);
  assert.doesNotMatch(at92, /create none/);
  assert.match(at98, /--arm --session other-chat/);
  assert.match(at98, /CronCreate a one-shot prompt at resumeAt/);
});

test('Given the stop band with and without a live mod, When a tool runs, Then it names the mod compacting at the reset or asks for /compact', () => {
  // Given
  const live = world(), none = world();
  mkdirSync(join(live, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(live, '.cache', 'pace', `${SID}.mod.json`), JSON.stringify({ v: 1, aliveAt: NOW - 2 * MIN }));
  // When
  const a = plan(pre('Bash'), ctx(live, pace(98.5)));
  const b = plan(pre('Bash'), ctx(none, pace(98.5)));
  // Then
  assert.match(text(a), /mod compacts at the reset/);
  assert.match(text(b), /run \/compact/);
});

test('Given a mod that stopped 4 minutes ago, When the stop band is told, Then it counts as absent', () => {
  // Given
  const dir = world();
  mkdirSync(join(dir, '.cache', 'pace'), { recursive: true });
  writeFileSync(join(dir, '.cache', 'pace', `${SID}.mod.json`), JSON.stringify({ v: 1, aliveAt: NOW - 4 * MIN }));
  // When
  const out = plan(pre('Bash'), ctx(dir, pace(98.5)));
  // Then
  assert.match(text(out), /run \/compact/);
});

test('Given a subagent, When 92% and 96% are crossed, Then it hears only the 85 advice, then nothing new; at the stop band it is told to close its step', () => {
  // Given
  const dir = world();
  const sub = pre('Bash', { agent_id: 'ag1', agent_type: 'implementer' });
  // When
  const at92 = plan(sub, ctx(dir, five(93, 10)));
  const at96 = plan(sub, ctx(dir, five(97, 10)));
  const at98 = plan(sub, ctx(dir, five(98.5, 10)));
  // Then
  assert.match(text(at92), /fewer agents/);
  assert.equal(at96, null);
  assert.match(text(at98), /Close your step now and report your state to the parent/);
});

test('Given a subagent and 7d, When 7d is at 98% and then 99%, Then it hears nothing at 98 and the close-your-step line at 99', () => {
  // Given
  const dir = world();
  const sub = pre('Bash', { agent_id: 'ag1', agent_type: 'implementer' });
  // When
  const at98 = plan(sub, ctx(dir, pace(10, 98.5)));
  const at99 = plan(sub, ctx(dir, pace(10, 99.5)));
  // Then
  assert.equal(at98 === null || !/Close your step/.test(text(at98)), true);
  assert.match(text(at99), /Close your step now and report your state to the parent/);
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

test('Given 92% short fresh data, When the main loop starts a Workflow, Then it is denied unless its input carries an override', () => {
  // Given
  const dir = world();
  const p = five(93, 10);
  const call = (tool_input, extra = {}) => plan(pre('Workflow', { tool_input, ...extra }), ctx(dir, p));
  // When
  const plain = call({ prompt: 'review the diff' });
  const quoted = call({ prompt: 'the owner asked for a review of the diff' });
  const asked = call({ prompt: 'review it, pace: owner asked' });
  const finish = call({ prompt: 'Pace: Finish the open step' });
  const inside = call({ prompt: 'x' }, { agent_id: 'ag1' });
  // Then
  assert.equal(decision(plain), 'deny');
  assert.equal(decision(quoted), 'deny');
  assert.equal(decision(asked), undefined);
  assert.equal(decision(finish), undefined);
  assert.equal(decision(inside), undefined);
});

test('Given the stop band on either window, When a Workflow starts, Then it is denied whatever the burn', () => {
  // Given
  const d5 = world(), d7 = world();
  // When
  const a = plan(pre('Workflow', { tool_input: { args: { brief: 'x' } } }), ctx(d5, pace(98.5)));
  const b = plan(pre('Workflow', { tool_input: { args: { brief: 'x' } } }), ctx(d7, pace(10, 99.5)));
  // Then
  assert.equal(decision(a), 'deny');
  assert.equal(decision(b), 'deny');
  assert.match(b.json.hookSpecificOutput.permissionDecisionReason, /7d window is at 99\.5%/);
});

test('Given data older than 10 minutes or a window past its reset, When a Workflow starts at the stop, Then the brake is lifted', () => {
  // Given
  const dir = world();
  const stale = pace(98.5, 10, { updatedAt: NOW - 11 * MIN });
  // When
  const old = plan(pre('Workflow'), ctx(dir, stale));
  const reset = plan(pre('Workflow'), ctx(world(), pace(98.5, 10, { updatedAt: R5 }), R5 + MIN));
  // Then
  assert.equal(old, null);
  assert.ok(reset === null || decision(reset) === undefined);
  assert.equal(decision(plan(pre('Workflow'), ctx(world(), pace(98.5, 10, { updatedAt: R5 }), R5 - MIN))), 'deny');
});

test('Given an unrelated tool at 95%, When it runs, Then it is never denied', () => {
  // Given
  const dir = world();
  // When
  const out = plan(pre('Bash'), ctx(dir, pace(95)));
  // Then
  assert.equal(decision(out), undefined);
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

test('Given 93% short fresh data, When the main loop starts one Agent or Task, Then it is not denied and the 92 notice asks for one subagent at a time and no critical operation', () => {
  // Given
  const dir = world();
  // When
  const agent = plan(pre('Agent', { tool_input: { prompt: 'x' } }), ctx(dir, five(93, 10)));
  const task = plan(pre('Task', { tool_input: { prompt: 'x' } }), ctx(world(), five(93, 10)));
  // Then
  assert.notEqual(decision(agent), 'deny');
  assert.notEqual(decision(task), 'deny');
  assert.match(text(agent), /one subagent at a time/);
  assert.match(text(agent), /no critical operation/);
});

test('Given 86% short, When the 85 notice is told, Then it asks for fewer parallel agents or a slower pace and keeps the models', () => {
  // Given
  const dir = world();
  // When
  const out = text(plan(pre('Bash'), ctx(dir, five(86, 10))));
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

test('Given the 7d window at 86% with a burn, When the 85 notice is told, Then it carries the burn and the estimated time of the next bands, 99 included', () => {
  // Given: 1 %/h from 86% reaches 99% in 13 h, before the 72 h reset
  const dir = world();
  // When
  const out = text(plan(pre('Bash'), ctx(dir, seven(86, 1))));
  // Then
  assert.match(out, /burning 1\.0%\/h/);
  assert.match(out, /next: .*99% ~/);
});
