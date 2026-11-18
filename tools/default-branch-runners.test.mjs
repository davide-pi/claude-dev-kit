// Tests for hooks/lib/default-branch.js: git behind a runner (xargs, command -p, watch, stdbuf). Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, onDefault } from './guard-shell-shared.test.mjs';

test('given a push behind xargs, command -p, watch or stdbuf, when run on the default branch, then each asks', () => {
  // Given
  const commands = [
    'xargs git push', 'echo x | xargs git push', 'xargs -I{} git push {}',
    'command -p git push', 'watch git push', 'stdbuf -o0 git push',
  ];
  for (const command of commands) {
    // When
    const { decision, reason } = run(command, onDefault);

    // Then
    assert.equal(decision, 'ask', command);
    assert.match(reason, /default branch/, command);
  }
});

test('given a runner that only receives git as text, when run on the default branch, then it does not ask', () => {
  // Given
  const commands = ['echo xargs git push', 'git log --grep "xargs git push"'];
  for (const command of commands) {
    // When
    const { decision } = run(command, onDefault);

    // Then
    assert.equal(decision, 'approve', command);
  }
});
