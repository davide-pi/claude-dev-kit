import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { evaluate } = createRequire(import.meta.url)('../hooks/lib/guard.js');
const decide = (tool_name, command, cwd = 'C:/repo') => evaluate({ tool_name, tool_input: { command }, cwd, session_id: 's1' })?.decision ?? 'pass';
const gate = 'node ~/.claude/scripts/gate.mjs';

test('given a function that may set the variable, when a kit script reads it, then the guard does not resolve it', () => {
  // Given
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

test('given a quoted name() in a commit message, when a kit script reads a variable assigned before it, then the guard resolves the variable', () => {
  // Given
  const command = `R='C:/repo'; git commit -m "fix init()"; ${gate} --root "$R" --test 'npm test'`;

  // When
  const decision = decide('Bash', command);

  // Then
  assert.notEqual(decision, 'deny');
});

test('given an unquoted function definition that may set the variable, when a kit script reads it, then the guard still does not resolve it', () => {
  // Given
  const commands = [
    `f() { R=x; }; f; ${gate} --root "$R" --test 'npm test'`,
    `R='C:/repo'; function f { R=x; }; f; ${gate} --root "$R" --test 'npm test'`,
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.equal(decision, 'deny', command);
  }
});
