// Tests: the kit can rewrite its own scanner and its test file with their unchanged content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(ROOT, 'hooks', 'secret-scan.js');

const decisionFor = (file) => {
  const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(ROOT, file), content: readFileSync(join(ROOT, file), 'utf8') } });
  const out = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' }).stdout;
  return /permissionDecision":"(\w+)/.exec(out)?.[1] ?? 'none';
};

test('given the scanner source and its test file, when each is written back unchanged, then secret-scan does not deny', () => {
  for (const file of ['hooks/secret-scan.js', 'tools/secret-scan.test.mjs']) {
    // Given / When
    const decision = decisionFor(file);

    // Then
    assert.notEqual(decision, 'deny', file);
  }
});

test('given a real-looking password in a source file outside tools, when it is written, then secret-scan denies', () => {
  // Given
  const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(ROOT, 'hooks', 'x.js'), content: `const c = "Server=h;${'Password='}${'Str0ngLocalPass'};";\n` } });

  // When
  const out = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' }).stdout;

  // Then
  assert.match(out, /permissionDecision":"deny/);
});
