// Tests for hooks/lib/guard.js: a read-only agent's git read with a shell redirect stays allowed. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { evaluate } from './guard-shell-shared.test.mjs';

const asReviewer = (command) => evaluate({ tool_name: 'Bash', tool_input: { command }, agent_type: 'code-reviewer', cwd: tmpdir(), session_id: 'redirects' });

test('given git branch, tag or remote reads ending in a redirect, when a read-only agent runs them, then none is denied', () => {
  // Given
  const commands = ['git branch -a 2>&1', 'git branch -a 2>/dev/null', 'git tag 2>&1', 'git remote -v 2>&1', 'git branch --list 2>&1'];
  for (const command of commands) {
    // When
    const result = asReviewer(command);

    // Then
    assert.equal(result?.decision, undefined, command);
  }
});

test('given a branch creation with a redirect, when a read-only agent runs it, then it is still denied', () => {
  // Given
  const command = 'git branch topic 2>&1';

  // When
  const result = asReviewer(command);

  // Then
  assert.equal(result?.decision, 'deny');
});
