import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { checkSqlTarget } = createRequire(import.meta.url)('../hooks/lib/sql-target.js');

test('given installing or inspecting a DB client package with a custom registry or -h, when the guard runs, then it is not denied', () => {
  // Given
  const commands = [
    'npm install mongosh --registry https://registry.example.com',
    'yarn add mysql -h pg-prod.example.com',
    'yarn info mongosh --registry https://npm.example.com',
  ];
  for (const command of commands) {
    // When
    const got = checkSqlTarget(command);
    // Then
    assert.notEqual(got?.decision, 'deny', command);
  }
});
