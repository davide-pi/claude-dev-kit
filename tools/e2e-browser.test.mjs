#!/usr/bin/env node
/**
 * Tests for hooks/lib/e2e-browser.js (the e2e-verifier browser check) and its wiring in hooks/edge-cdp.js.
 * Zero dependencies — `node:test` on Node 18+.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { checkE2eBrowser } = createRequire(import.meta.url)(join(ROOT, 'hooks', 'lib', 'e2e-browser.js'));

const PREFIX = 'mcp__plugin_browser-use_browser-use__';
const exec = (code, agent_type = 'e2e-verifier') => ({ tool_name: `${PREFIX}browser_exec`, tool_input: { code }, agent_type });

const DENIED_CODE = {
  'a remote daemon': 'start_remote_daemon()',
  'a foreign http URL': "new_tab('https://example.com/login')",
  'a foreign ws URL': "cdp('ws://10.0.0.5:9222/devtools')",
  'a foreign host behind a localhost userinfo': `goto_url('http://localhost${'@'}evil.example/x')`,
  'subprocess': 'import subprocess; subprocess.run(["ls"])',
  'os.system': "import os; os.system('dir')",
  'os.popen': "import os; os.popen('dir')",
  'os.remove': "import os; os.remove('a.txt')",
  'shutil': "import shutil; shutil.rmtree('x')",
  'write_text': "Path('a.txt').write_text('x')",
  'write_bytes': "Path('a.bin').write_bytes(b'x')",
  'unlink': "Path('a.txt').unlink()",
  'open for writing': "open('a.txt', 'w').write('x')",
  'open for appending': "open('a.txt', mode='a')",
  'open for update': "open('a.txt', 'r+')",
  'open with a nested path call': "open(os.path.join(tmp, 'shot.png'), 'wb')",
  'os.startfile': "import os; os.startfile('cmd.exe')",
  'os.execv': "import os; os.execv('/bin/sh', ['sh'])",
  'from os import': "from os import system; system('x')",
  'shutil alias': "import shutil as s; s.rmtree('p')",
  'asyncio subprocess': "await asyncio.create_subprocess_shell('dir')",
  'exec': "exec('print(1)')",
  'eval': "eval('1+1')",
  '__import__': "__import__('os')",
};

test('given an e2e-verifier browser_exec call, when its code is one of the forbidden shapes, then the check denies', () => {
  for (const [name, code] of Object.entries(DENIED_CODE)) {
    // Given
    const payload = exec(code);
    // When
    const result = checkE2eBrowser(payload);
    // Then
    assert.ok(result?.reason, name);
  }
});

test('given an e2e-verifier, when it calls browser_login, then the check denies', () => {
  // Given
  const payload = { tool_name: `${PREFIX}browser_login`, tool_input: {}, agent_type: 'e2e-verifier' };
  // When
  const result = checkE2eBrowser(payload);
  // Then
  assert.match(result.reason, /browser_login/);
});

test('given an e2e-verifier, when its code drives localhost pages and reads, then the check allows', () => {
  for (const code of ["new_tab('http://localhost:3000/orders')", "goto_url('http://127.0.0.1:5000/')", "goto_url('http://[::1]:8080/x')",
    "goto_url('http://host.docker.internal:9000/')", "goto_url('https://app.localhost/x')", "print(page_info())", "f = open('a.txt'); f.read()", "open('a.txt', 'rb')", "open(os.path.join(d, 'a.txt'), 'r')"]) {
    // Given
    const payload = exec(code);
    // When
    const result = checkE2eBrowser(payload);
    // Then
    assert.equal(result, null, code);
  }
});

test('given the same forbidden code, when it comes from another agent or the main session, then the check allows', () => {
  for (const agent_type of ['implementer', undefined]) {
    // Given
    const as = (code) => ({ ...exec(code), agent_type });
    const payloads = [as('start_remote_daemon()'), as("goto_url('https://example.com')"),
      { tool_name: `${PREFIX}browser_login`, tool_input: {}, agent_type }];
    for (const payload of payloads) {
      // When
      const result = checkE2eBrowser(payload);
      // Then
      assert.equal(result, null, JSON.stringify(payload));
    }
  }
});

test('given a payload the check cannot read, when it runs, then it allows instead of throwing', () => {
  // Given
  const payloads = [null, undefined, { agent_type: 'e2e-verifier' }, { agent_type: 'e2e-verifier', tool_name: `${PREFIX}browser_exec`, tool_input: null }];
  for (const payload of payloads) {
    // When
    const result = checkE2eBrowser(payload);
    // Then
    assert.equal(result, null);
  }
});

test('given edge-cdp wired to the check, when an e2e-verifier calls browser_login, then the hook prints a deny', () => {
  // Given
  const config = mkdtempSync(join(tmpdir(), 'e2e-browser-'));
  const input = JSON.stringify({ tool_name: `${PREFIX}browser_login`, tool_input: {}, agent_type: 'e2e-verifier' });
  try {
    // When
    const r = spawnSync(process.execPath, [join(ROOT, 'hooks', 'edge-cdp.js')], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config } });
    // Then
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.equal(out.permissionDecision, 'deny');
  } finally {
    rmSync(config, { recursive: true, force: true });
  }
});
