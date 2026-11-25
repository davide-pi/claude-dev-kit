// Tests for the permission rules of settings.json: config edits and remote or prod writes ask; local recoverable commands are left to guard-shell and the classifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeSettings } from './merge-settings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const settings = JSON.parse(readFileSync(join(ROOT, 'settings.json'), 'utf8'));
const { allow, ask } = settings.permissions;

const FOUR = ['git checkout -- file.txt', 'git restore file.txt', 'git branch -D topic', 'git worktree remove ../wt'];
const TOOLS = ['Bash', 'PowerShell'];

/** Whether a `Tool(spec)` rule (`*` is a wildcard) or a bare `Tool` rule covers `tool` running `command`. */
function covers(rule, tool, command) {
  const m = /^(\w+)(?:\((.*)\))?$/.exec(rule);
  if (!m || m[1] !== tool) return false;
  if (m[2] === undefined) return true;
  const re = new RegExp(`^${m[2].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return re.test(command);
}
const coveredBy = (rules, tool, command) => rules.filter((rule) => covers(rule, tool, command));

test('given settings.json, when parsed, then ask has Edit for the hooks, the settings files and CLAUDE.md, and no Write rule for them', () => {
  // Given
  const paths = ['~/.claude/hooks/**', '~/.claude/settings*.json', '~/.claude/CLAUDE.md'];

  for (const path of paths) {
    // When / Then: Edit rules cover every file write; Claude Code warns that a Write(path) rule never matches
    assert.ok(ask.includes(`Edit(${path})`), `Edit(${path})`);
    assert.ok(!ask.includes(`Write(${path})`), `Write(${path}) never matches`);
  }
});

test('given settings.json, when parsed, then allow has none of the four git commands', () => {
  for (const tool of TOOLS) {
    for (const command of FOUR) {
      // When
      const allowed = coveredBy(allow, tool, command);

      // Then
      assert.deepEqual(allowed, [], `${tool}: ${command} allowed by ${allowed}`);
    }
  }
});

test('given the kit settings.json, when ask is matched against local recoverable or guard-shell-covered commands, then no Bash or PowerShell ask rule covers them', () => {
  // Given
  const local = [
    'rm -rf dist', 'rm -fr dist', 'rm -r dist', 'Remove-Item -Recurse dist', 'Remove-Item -Force dist',
    'git reset --hard', 'git rebase main', 'git cherry-pick abc123', 'docker compose down', 'dotnet tool install -g dotnet-ef',
    'dotnet ef migrations remove', ...FOUR,
  ];
  for (const tool of TOOLS) {
    for (const command of local) {
      // When
      const asked = coveredBy(ask, tool, command);

      // Then
      assert.deepEqual(asked, [], `${tool}: ${command} still asked by ${asked}`);
    }
  }
});

test('given the kit settings.json, when ask is matched against remote, prod and config writes, then each is still asked in both shells', () => {
  // Given
  const remote = [
    'git push --force origin x', 'git push -f origin x', 'git push --force-with-lease origin x', 'git push --delete origin x',
    'git push -d origin x', 'git push origin :x', 'kubectl delete pod api', 'az boards work-item delete --id 1 --yes',
    'az repos delete --id r', 'az pipelines delete --id 1', 'dotnet ef database update',
  ];
  const mcpWiring = settings.hooks.PreToolUse.find((g) => g.matcher === 'mcp__.*');
  for (const tool of TOOLS) {
    for (const command of remote) {
      // When
      const asked = coveredBy(ask, tool, command);

      // Then
      assert.ok(asked.length > 0, `${tool}: ${command} not asked`);
    }
  }
  for (const path of ['~/.claude/hooks/**', '~/.claude/settings*.json', '~/.claude/CLAUDE.md']) assert.ok(ask.includes(`Edit(${path})`), `Edit(${path})`);
  assert.match(JSON.stringify(mcpWiring?.hooks ?? []), /mcp-readonly-guard\.js/, 'MCP writes stay gated by mcp-readonly-guard.js');
});

test('given allow, when scanned, then no broader pattern re-allows the four git commands', () => {
  // Given
  const broad = allow.filter((rule) => /^(Bash|PowerShell)(\(\*?\))?$|^(Bash|PowerShell)\(git \*\)$/.test(rule));

  // When / Then
  assert.deepEqual(broad, []);
});

test('given merge-settings with the template, when merged with an empty overlay, then the four are absent from allow', () => {
  // Given
  const merged = mergeSettings(settings, {});

  for (const tool of TOOLS) {
    for (const command of FOUR) {
      // When / Then
      assert.deepEqual(coveredBy(merged.permissions.allow, tool, command), [], `${tool}: ${command}`);
    }
  }
});

test('given node tools/validate.mjs, when run, then it is clean', () => {
  // Given / When
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'validate.mjs')], { cwd: ROOT, encoding: 'utf8' });

  // Then
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
