// Tests: a crash in the script-args or body-lines check answers ask, never lets the command through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.CLAUDE_CONFIG_DIR = tmpdir();
const require = createRequire(import.meta.url);
const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'lib');

/** `evaluate` from a fresh guard.js whose dependency `module.name` throws. */
function crashedEvaluate(module, name) {
  const dep = require(join(LIB, module));
  const original = dep[name];
  dep[name] = () => { throw new Error('boom'); };
  delete require.cache[require.resolve(join(LIB, 'guard.js'))];
  try {
    return require(join(LIB, 'guard.js')).evaluate;
  } finally {
    dep[name] = original;
  }
}

test('given a crashing script-args check, when an allowed kit script gets a substitution, then the guard asks', () => {
  // Given
  const evaluate = crashedEvaluate('script-args.js', 'checkScriptArgs');
  const payload = { tool_name: 'PowerShell', tool_input: { command: 'pwsh -NoProfile -File ~/.claude/scripts/db-ro.ps1 -Env prod -Query $(Remove-Item x)' }, cwd: tmpdir(), session_id: 'p' };

  // When
  const result = evaluate(payload);

  // Then
  assert.equal(result?.decision, 'ask');
});

test('given a crashing body-lines check, when any command runs, then the guard asks', () => {
  // Given
  const evaluate = crashedEvaluate('shell-parse.js', 'runnableBodyLines');
  const payload = { tool_name: 'Bash', tool_input: { command: 'echo hi' }, cwd: tmpdir(), session_id: 'p' };

  // When
  const result = evaluate(payload);

  // Then
  assert.equal(result?.decision, 'ask');
});
