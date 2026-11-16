import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { evaluate } = createRequire(import.meta.url)('../hooks/lib/guard.js');
const decide = (tool_name, command, cwd = 'C:/repo') => evaluate({ tool_name, tool_input: { command }, cwd, session_id: 's1' })?.decision ?? 'pass';

test('given a here-string piped to Set-Content and then run, when the guard reads it, then it asks', () => {
  // Given
  const command = "@'\nRemove-Item -Recurse -Force C:/repo/src\n'@ | Set-Content s.ps1; pwsh -File s.ps1";

  // When
  const decision = decide('PowerShell', command);

  // Then
  assert.equal(decision, 'ask');
});
