// Tests: a PowerShell parenthesised secret read stays denied when member access, an index or an operator follows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { checkSecretRead } = createRequire(import.meta.url)(join(ROOT, 'hooks', 'lib', 'secret-read.js'));

test('given a parenthesised Get-Content of .env followed by .Length, an index, -join or an assignment with .Trim(), when checkSecretRead runs, then each is stopped', () => {
  // Given
  const commands = ['(Get-Content .env).Length', '(Get-Content .env) -join ""', '(gc .env)[0]', '$x = (Get-Content .env).Trim()', '(Get-Content .env)'];
  for (const command of commands) {
    // When
    const found = checkSecretRead(command);

    // Then
    assert.ok(found, command);
  }
});

test('given a parenthesised Get-Content of an ordinary file with a member access, when checkSecretRead runs, then it is left alone', () => {
  // Given
  const command = '(Get-Content notes.txt).Length';

  // When
  const found = checkSecretRead(command);

  // Then
  assert.equal(found, null);
});
