// Tests: a database client behind an unknown launcher is asked about even when another segment names the same client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runShell } from './guard-shell-shared.test.mjs';

test('given a prod client behind setsid or taskset after a harmless call to the same client, when the guard runs, then it asks', () => {
  // Given
  const commands = [
    'setsid psql -h prod -c x',
    'psql --version; setsid psql -h prod -c x',
    'psql -h localhost -c 1; setsid psql -h prod -c x',
    'sqlcmd -S localhost -Q 1 && taskset 1 sqlcmd -S prod -Q x',
  ];
  for (const command of commands) {
    // When
    const { decision, reason } = runShell(command);

    // Then
    assert.equal(decision, 'ask', command);
    assert.match(reason, /database client/i, command);
  }
});

test('given a client named as text after echo, when the guard runs, then it does not ask', () => {
  // Given
  const command = 'echo sqlcmd -S prod';

  // When
  const { decision } = runShell(command);

  // Then
  assert.equal(decision, 'approve');
});
