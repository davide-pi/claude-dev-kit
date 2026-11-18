// Tests: a push to the default branch behind a runner the guard does not list, or in a case arm, still asks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, onDefault } from './guard-shell-shared.test.mjs';

test('given a push behind winpty, flock, doas, parallel, find -exec or a case arm, when run on the default branch, then each asks', () => {
  // Given
  const commands = [
    'winpty git push origin main', 'flock /tmp/l git push origin main', 'doas git push origin main',
    'parallel git push ::: main', 'find . -exec git push origin main \\;', 'case x in x) git push origin main ;; esac',
  ];
  for (const command of commands) {
    // When
    const { decision, reason } = run(command, onDefault);

    // Then
    assert.equal(decision, 'ask', command);
    assert.match(reason, /default branch/, command);
  }
});

test('given a search for the words git push, when run on the default branch, then it does not ask', () => {
  // Given
  const commands = ['grep git push notes.txt', 'printf git push'];
  for (const command of commands) {
    // When
    const { decision } = run(command, onDefault);

    // Then
    assert.equal(decision, 'approve', command);
  }
});
