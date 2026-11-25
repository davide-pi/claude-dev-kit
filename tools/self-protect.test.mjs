#!/usr/bin/env node
/**
 * Tests for hooks/lib/self-protect.js, through hooks/guard-shell.js (its only caller). Zero
 * dependencies — `node:test` on Node 18+.
 *
 *   node --test "tools/*.test.mjs"
 *
 * Every case runs from an empty temp directory. Half the cases are writes outside ~/.claude that
 * must stay silent for this check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-shell.js');
const cwd = mkdtempSync(join(tmpdir(), 'selfprot-'));
process.on('exit', () => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* tmp */ } });

function run(command, tool_name = 'Bash') {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name, tool_input: { command }, cwd }), encoding: 'utf8',
  });
  assert.equal(r.status, 0, 'the hook must always exit 0');
  if (!r.stdout.trim()) return { decision: 'approve', reason: '' };
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  return { decision: out.permissionDecision, reason: out.permissionDecisionReason ?? '' };
}

const CONFIG = /Claude configuration/;

function asksAboutConfig(commands, tool_name = 'Bash') {
  for (const command of commands) {
    // When
    const r = run(command, tool_name);

    // Then
    assert.equal(r.decision, 'ask', command);
    assert.match(r.reason, CONFIG, command);
  }
}

test('given a redirect glued to a protected path, when the hook runs, then it asks', () => {
  // Given
  const commands = [
    'echo x>~/.claude/settings.json', 'echo x>>$HOME/.claude/hooks/a.js', 'echo x 2>~/.claude/CLAUDE.md',
  ];

  // When / Then
  asksAboutConfig(commands);
});

test('given a delete of a protected path, when the hook runs, then it asks', () => {
  // Given
  const commands = [
    'Remove-Item ~/.claude/settings.json', 'rm ~/.claude/hooks/guard-shell.js', 'del ~/.claude/settings.json',
    'ri ~/.claude/settings.json', 'rd ~/.claude/hooks', 'rmdir ~/.claude/hooks', 'erase ~/.claude/CLAUDE.md',
    'Remove-Item -Path ~/.claude/hooks -Recurse',
  ];

  // When / Then
  asksAboutConfig(commands);
});

test('given a move or rename whose source is protected, when the hook runs, then it asks', () => {
  // Given
  const commands = [
    'mv ~/.claude/settings.json /tmp/x', 'Move-Item -Path ~/.claude/hooks x', 'Rename-Item ~/.claude/settings.json s.bak',
  ];

  // When / Then
  asksAboutConfig(commands);
});

test('given a .NET file call on a protected path, when the hook runs, then it asks', () => {
  // Given
  const commands = [
    "[IO.File]::WriteAllText('~/.claude/settings.json', 'x')",
    "[IO.File]::AppendAllText('~/.claude/settings.json', 'x')",
    "[IO.File]::WriteAllLines('~/.claude/settings.json', @('x'))",
    "[IO.File]::WriteAllBytes('~/.claude/settings.json', $b)",
    "[IO.File]::Delete('~/.claude/settings.json')",
    "[IO.File]::Move('~/.claude/settings.json', 'x')",
    "[IO.File]::Copy('x', '~/.claude/settings.json')",
  ];

  // When / Then
  asksAboutConfig(commands, 'PowerShell');
});

test('given the home written as a variable or in absolute form, when the hook runs, then it asks', () => {
  // Given
  const abs = join(homedir(), '.claude', 'settings.json').replace(/\\/g, '/');
  const commands = [
    'Set-Content $env:USERPROFILE\\.claude\\settings.local.json x',
    'echo x > %USERPROFILE%\\.claude\\settings.json',
    `echo x > ${abs}`,
  ];

  // When / Then
  asksAboutConfig(commands);
});

test('given a delete or move outside the Claude configuration, when the hook runs, then self-protect stays silent', () => {
  // Given
  const commands = ['Remove-Item ./build', 'mv a b', 'rm -rf ./build', 'echo x>out.txt'];
  for (const command of commands) {
    // When
    const r = run(command);

    // Then
    assert.doesNotMatch(r.reason, CONFIG, command);
  }
});
