import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { evaluate } = createRequire(import.meta.url)('../hooks/lib/guard.js');
const decide = (tool_name, command, cwd = 'C:/repo') => evaluate({ tool_name, tool_input: { command }, cwd, session_id: 's1' })?.decision ?? 'pass';

test('given a function that may set the variable, when a kit script reads it, then the guard does not resolve it', () => {
  // Given
  const gate = 'node ~/.claude/scripts/gate.mjs';
  const cases = [
    ['Bash', `git() { printf -v "$1" %s "$2"; }; P=C:/repo/a; git P --lane-remove; ${gate} "$P"`],
    ['PowerShell', `function git { Set-Variable -Name $args[0] -Value $args[1] -Scope 1 }; $P = 'C:/repo/a'; git P '--lane-remove'; ${gate} "$P"`],
  ];

  for (const [tool, command] of cases) {
    // When
    const decision = decide(tool, command);

    // Then
    assert.equal(decision, 'deny', tool);
  }
});
