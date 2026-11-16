/**
 * Shared setup of the guard-shell tests (tools/guard-shell-*.test.mjs) (a test file with no test, so it stays in the perimeter): the guards run in-process through
 * `run` / `runRaw`, the default-branch fixtures are rebuilt before every test, and the helpers more than
 * one topic file uses live here.
 */

import { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync, utimesSync, symlinkSync, realpathSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// The guards read the workspace map, settings and the error log from the config directory: point it at an
// empty one before they load, so neither the machine's own map nor its log takes part in a test.
export const configDir = mkdtempSync(join(tmpdir(), 'guard-config-'));
process.env.CLAUDE_CONFIG_DIR = configDir;
export const { evaluate } = createRequire(import.meta.url)('../hooks/lib/guard.js');

export const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-shell.js');
export const SHA = '0'.repeat(40);
export const created = [configDir];

/** A repo checked out on `current`, whose origin/HEAD names `defaultBranch`. */
export function fixture(current, defaultBranch = 'main', prefix = 'guard-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  created.push(root);
  const gitDir = join(root, '.git');
  mkdirSync(join(gitDir, 'refs', 'remotes', 'origin'), { recursive: true });
  writeFileSync(join(gitDir, 'HEAD'), `ref: refs/heads/${current}\n`);
  writeFileSync(
    join(gitDir, 'refs', 'remotes', 'origin', 'HEAD'),
    `ref: refs/remotes/origin/${defaultBranch}\n`,
  );
  for (const branch of new Set([current, defaultBranch])) {
    const ref = join(gitDir, 'refs', 'heads', branch);
    mkdirSync(dirname(ref), { recursive: true }); // `feature/x` is a nested path
    writeFileSync(ref, `${SHA}\n`);
  }
  return root;
}

process.on('exit', () => {
  for (const root of created) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* tmp, let the OS have it */ }
  }
});

/** The hook's decision as the tests read it: approve (silent), ask, deny or allow (a rewrite). */
export function decisionOf(result) {
  if (!result) return { decision: 'approve', reason: '' };
  if (result.rewrite) return { decision: 'allow', reason: undefined, updatedInput: result.rewrite };
  return { decision: result.decision, reason: result.reason };
}

/**
 * Run the guards in-process on a payload: the same `evaluate` the hook calls, without a Node start-up
 * per case (that was ~80 ms each, most of the file's run time). Input that is not JSON is what the hook
 * reads as no payload at all. `spawnRaw` keeps the real process for what only a process can show.
 */
export function runRaw(input) {
  let payload = null;
  try { payload = JSON.parse(input); } catch { /* the hook approves unreadable input */ }
  return decisionOf(evaluate(payload));
}

/** Run the hook as a process on raw stdin and return its decision: the exit code and the JSON protocol. */
export function spawnRaw(input) {
  const result = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  assert.equal(result.status, 0, 'the hook must always exit 0, whatever happens');
  if (!result.stdout.trim()) return { decision: 'approve', reason: '' };
  const { hookSpecificOutput: out } = JSON.parse(result.stdout);
  assert.equal(out.hookEventName, 'PreToolUse');
  return { decision: out.permissionDecision, reason: out.permissionDecisionReason };
}

export const run = (command, cwd) => runRaw(JSON.stringify({ tool_input: { command }, cwd }));

// Fresh repositories for every test, each in its own temp directory: nothing is shared between tests
// or between parallel runs of this file.
export let onDefault;
export let onFeature;
beforeEach(() => {
  onDefault = fixture('main');
  onFeature = fixture('feature/x');
});


/** A destructive-check case, run from a working branch so only that check can answer. */
export const runShell = (command) => run(command, onFeature);

/** Every asked case must carry a reason, or the prompt tells the user nothing. */
export function asks(command, reasonPattern) {
  const { decision, reason } = runShell(command);
  assert.equal(decision, 'ask', command);
  assert.match(reason, /Confirm\?$/, command);
  if (reasonPattern) assert.match(reason, reasonPattern, command);
}

export const approves = (command) => assert.equal(runShell(command).decision, 'approve', command);

export const runTool = (tool_name, command) => runRaw(JSON.stringify({ tool_name, tool_input: { command }, cwd: onFeature }));
export const DB = 'pwsh -NoProfile -File ~/.claude/scripts/db-ro.ps1';
export const PERIMETER = 'pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1';
export const SNAPSHOT = 'pwsh -NoProfile -File ~/.claude/scripts/snapshot.ps1';
export const BOTH = ['Bash', 'PowerShell'];

export const GATE = 'node ~/.claude/scripts/gate.mjs --root . --head abc123';

// The batching nudge: five shell calls in a row, each alone in its request, earn one reminder.
export const { nudgeFor } = createRequire(import.meta.url)('../hooks/lib/batch-nudge.js');
export const NUDGE = 'Independent calls go in parallel in one message; dependent ones are chained in one command, never starting with cd; use git -C and absolute paths.';

/** A config dir whose session `s1` already holds four single calls, 20 s apart. */
export function seededConfig() {
  const config = mkdtempSync(join(tmpdir(), 'guard-nudge-'));
  created.push(config);
  mkdirSync(join(config, '.cache'), { recursive: true });
  const now = Date.now();
  writeFileSync(join(config, '.cache', 'batch-nudge-s1.txt'), [80_000, 60_000, 40_000, 20_000].map((ago) => `${now - ago}\n`).join(''));
  return config;
}

export const stateFile = (config) => join(config, '.cache', 'batch-nudge-s1.txt');
export const hookInput = (command, extra = {}) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: onFeature, session_id: 's1', ...extra });

/** Run the hook once; the stdout `hookSpecificOutput`, or null when it printed nothing. */
export function runHook(config, command, extra) {
  const r = spawnSync(process.execPath, [HOOK], { input: hookInput(command, extra), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

export const GATE_CALL = 'node ~/.claude/scripts/gate.mjs';
export const bashOnly = (command) => runTool('Bash', command).decision;
export const psOnly = (command) => runTool('PowerShell', command).decision;
