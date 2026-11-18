// Tests: many open braces in the tail of a command must not make commandPositions exponential.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'lib', 'shell-parse.js');

test('given a commit message with 40 open braces, when commandPositions runs, then it finishes within a few seconds', () => {
  // Given
  const command = `git commit -m "${'a{b '.repeat(40)}"`;
  const script = `const { commandPositions } = require(${JSON.stringify(LIB)}); console.log(commandPositions(${JSON.stringify(command)}).length)`;

  // When
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });

  // Then
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
});

test('given a block opened after a brace in a later token, when commandPositions runs, then the command inside it is still a head', () => {
  // Given
  const command = 'if ($a) {sqlcmd -S h -Q x}';

  // When
  const heads = createHeads(command);

  // Then
  assert.ok(heads.includes('sqlcmd'));
});

function createHeads(command) {
  const script = `const { commandPositions } = require(${JSON.stringify(LIB)}); console.log(JSON.stringify(commandPositions(${JSON.stringify(command)}).map((t) => t[0])))`;
  return JSON.parse(spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }).stdout);
}
