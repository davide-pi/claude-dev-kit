// Tests for hooks/lib/guard.js: git named only as text (a search, an echo) is not a git call for a read-only agent. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { evaluate } from './guard-shell-shared.test.mjs';

const asExplore = (command) => evaluate({ tool_name: 'Bash', tool_input: { command }, agent_type: 'Explore', cwd: tmpdir(), session_id: 'text-git' });

test('given a search or an echo that names git as text, when a read-only agent runs it, then none is denied', () => {
  // Given
  const commands = ['grep -rn git hooks/', 'rg "git" README.md', 'echo git is here', 'find . -name git -type d', 'Select-String -Pattern git -Path x'];
  for (const command of commands) {
    // When
    const result = asExplore(command);

    // Then
    assert.equal(result?.decision, undefined, command);
  }
});

test('given git behind a launcher, when a read-only agent runs a write through it, then it is denied', () => {
  // Given
  const commands = ['setsid git push', 'flock x git commit -m m', 'xargs git reset --hard'];
  for (const command of commands) {
    // When
    const result = asExplore(command);

    // Then
    assert.equal(result?.decision, 'deny', command);
  }
});
