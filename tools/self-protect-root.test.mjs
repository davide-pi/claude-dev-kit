// Tests for hooks/lib/self-protect.js: moving or deleting the whole ~/.claude directory, through hooks/guard-shell.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-shell.js');
const cwd = mkdtempSync(join(tmpdir(), 'selfprot-root-'));
process.on('exit', () => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* tmp */ } });

function decide(command, tool_name) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input: { command }, cwd }), encoding: 'utf8' });
  assert.equal(r.status, 0, 'the hook must always exit 0');
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'approve';
}

test('given a move, rename or delete of the whole ~/.claude directory, when guard-shell runs, then each asks', () => {
  // Given
  const cases = [
    ['Bash', 'mv ~/.claude ~/.claude.bak'], ['Bash', 'mv ~/.claude x'], ['Bash', 'rm -rf ~/.claude'],
    ['PowerShell', 'mv ~/.claude ~/.claude.bak'], ['PowerShell', 'Rename-Item ~/.claude x'],
    ['PowerShell', 'Move-Item -Path ~/.claude -Destination x'], ['PowerShell', 'Remove-Item ~/.claude -Recurse'],
  ];
  for (const [tool, command] of cases) {
    // When
    const decision = decide(command, tool);

    // Then
    assert.equal(decision, 'ask', `${tool}: ${command}`);
  }
});

test('given a copy of ~/.claude or a move of a sibling directory, when guard-shell runs, then it does not ask', () => {
  // Given
  const cases = [['Bash', 'cp -r ~/.claude backup'], ['Bash', 'mv ~/.claude-other x'], ['PowerShell', 'Copy-Item ~/.claude backup -Recurse']];
  for (const [tool, command] of cases) {
    // When
    const decision = decide(command, tool);

    // Then
    assert.equal(decision, 'approve', `${tool}: ${command}`);
  }
});
