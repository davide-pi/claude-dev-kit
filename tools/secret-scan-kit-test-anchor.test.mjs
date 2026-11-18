// Tests for hooks/secret-scan.js: the kit-fixture exemption holds only inside the kit's own checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'secret-scan.js');
// Assembled: the validator's leak scan would otherwise read the specimens as leaks.
const connection = `const cs = "Server=prod.db;Database=app;User Id=sa;${'Password='}${'Zq8vR2mK9pLw4Tn'};";`;
const keyBlock = `${'-----BEGIN RSA PRIVATE'} KEY-----\nMIIEowIBAAKCAQEA\n`;

const decisionFor = (file, content) => {
  const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file, content } });
  const out = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' }).stdout;
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'approve';
};

test('given a project outside the kit with a tools test file, when a connection string or a private key is written, then it is denied', () => {
  // Given
  const file = join(process.platform === 'win32' ? 'C:\\work\\shop' : '/work/shop', 'tools', 'db.test.js');

  // When / Then
  assert.equal(decisionFor(file, connection), 'deny');
  assert.equal(decisionFor(file, keyBlock), 'deny');
});
