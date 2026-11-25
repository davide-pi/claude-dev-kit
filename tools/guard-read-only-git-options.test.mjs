// Tests for hooks/lib/guard.js: a read-only agent may not smuggle a command or a file write through a git read verb. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { evaluate } from './guard-shell-shared.test.mjs';

const asReviewer = (command) => evaluate({ tool_name: 'Bash', tool_input: { command }, agent_type: 'code-reviewer', cwd: tmpdir(), session_id: 'options' });

test('given a git read verb carrying -c, --exec-path, --output, --ext-diff or -O, when a read-only agent runs it, then each is denied', () => {
  // Given
  const commands = ['git -c core.fsmonitor=calc status', 'git -c core.pager=calc log', 'git --exec-path=x status', 'git diff --output=hooks/x.js',
    'git log --output x', 'git diff --ext-diff', 'git grep -Ocalc foo', 'git grep --open-files-in-pager=calc foo'];
  for (const command of commands) {
    // When
    const result = asReviewer(command);

    // Then
    assert.equal(result?.decision, 'deny', command);
  }
});

test('given plain git status, diff, log and grep with -C, when a read-only agent runs them, then none is denied', () => {
  // Given
  const commands = ['git status', 'git -C sub status', 'git diff --stat HEAD~1', 'git log -n 3 --oneline', 'git grep -n foo'];
  for (const command of commands) {
    // When
    const result = asReviewer(command);

    // Then
    assert.equal(result?.decision, undefined, command);
  }
});
