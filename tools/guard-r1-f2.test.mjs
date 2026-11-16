import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { evaluate } = createRequire(import.meta.url)('../hooks/lib/guard.js');
const decide = (tool_name, command, cwd = 'C:/repo') => evaluate({ tool_name, tool_input: { command }, cwd, session_id: 's1' })?.decision ?? 'pass';

test('given a PowerShell here-string written to a script, when a runner follows, then the guard asks', () => {
  // Given
  const commands = [
    "Set-Content f.ps1 @'\nRemove-Item -Recurse C:/x/y\n'@\npwsh f.ps1",
    "Set-Content f.ps1 @'\nRemove-Item -Recurse C:/x/y\n'@\n./f.ps1",
  ];

  for (const command of commands) {
    // When
    const decision = decide('PowerShell', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});
