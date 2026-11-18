// Tests: a database client to a dev host inside a PowerShell block head (if/foreach) is not asked about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psOnly } from './guard-shell-shared.test.mjs';

test('given a dev-host client inside an if or foreach block in PowerShell, when the guard runs, then it approves', () => {
  // Given
  const commands = [
    'if ($a) { sqlcmd -S localhost -Q x }',
    'foreach ($d in $l) { psql -h localhost -c x }',
    'try { sqlcmd -S localhost -Q x } catch {}',
  ];
  for (const command of commands) {
    // When
    const decision = psOnly(command);

    // Then
    assert.equal(decision, 'approve', command);
  }
});
