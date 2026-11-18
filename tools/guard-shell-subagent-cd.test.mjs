// Tests for hooks/guard-shell.js: a subagent's command that starts with cd is denied with the way round it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnRaw } from './guard-shell-shared.test.mjs';

const input = (command, extra = {}, tool_name = 'Bash') =>
  JSON.stringify({ tool_name, tool_input: { command }, cwd: process.cwd(), session_id: 's1', ...extra });
const SUBAGENT = { agent_id: 'a1', agent_type: 'implementer' };

for (const [tool, command] of [
  ['Bash', 'cd /c/repo-lane && git status --short'],
  ['Bash', 'cd "C:/repo lane" ; node --test'],
  ['PowerShell', 'Set-Location C:\\repo-lane; git status'],
  ['PowerShell', 'pushd C:\\repo-lane && git diff'],
]) {
  test(`given a subagent ${tool} call \`${command}\`, when guard-shell runs, then it denies and names git -C and absolute paths`, () => {
    // Given
    const payload = input(command, SUBAGENT, tool);
    // When
    const out = spawnRaw(payload);
    // Then
    assert.equal(out.decision, 'deny');
    assert.match(out.reason, /git -C/);
    assert.match(out.reason, /absolute path/);
  });
}

test('given the main session (no agent_type), when it sends cd X && git status, then the cd rule does not deny', () => {
  // Given
  const payload = input('cd /c/repo && git status');
  // When
  const out = spawnRaw(payload);
  // Then
  assert.notEqual(out.decision, 'deny');
});

test('given a subagent command without a leading cd, when guard-shell runs, then the cd rule does not deny', () => {
  // Given
  const payload = input('git -C /c/repo status --short', SUBAGENT);
  // When
  const out = spawnRaw(payload);
  // Then
  assert.notEqual(out.decision, 'deny');
});

test('given a subagent bare cd with no chained command, when guard-shell runs, then the cd rule does not deny', () => {
  // Given
  const payload = input('cd /c/repo', SUBAGENT);
  // When
  const out = spawnRaw(payload);
  // Then
  assert.notEqual(out.decision, 'deny');
});
