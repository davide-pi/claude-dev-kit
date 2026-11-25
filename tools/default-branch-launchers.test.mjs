// Tests: the default-branch ask must survive any launcher in front of git. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, onDefault } from './guard-shell-shared.test.mjs';

test('given a push behind setsid, flock, taskset, ionice, caffeinate, unbuffer or builtin, when run on the default branch, then each asks', () => {
  // Given
  const commands = ['setsid git push', 'flock x git push', 'taskset 1 git push', 'ionice git push', 'caffeinate git push', 'unbuffer git push', 'builtin git push'];
  for (const command of commands) {
    // When
    const { decision, reason } = run(command, onDefault);

    // Then
    assert.equal(decision, 'ask', command);
    assert.match(reason, /default branch/, command);
  }
});

test('given git named only as text after echo, when run on the default branch, then it does not ask', () => {
  // Given
  const command = 'echo git push';

  // When
  const { decision } = run(command, onDefault);

  // Then
  assert.equal(decision, 'approve');
});
