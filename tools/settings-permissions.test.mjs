// Tests for the permission rules of settings.json: config edits ask, and the four destructive git commands ask instead of being allowed.
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

test('given settings.json, when parsed, then ask has Edit and Write for the hooks, the settings files and CLAUDE.md', () => {
  // Given
  const paths = ['~/.claude/hooks/**', '~/.claude/settings*.json', '~/.claude/CLAUDE.md'];

  for (const tool of ['Edit', 'Write']) {
    for (const path of paths) {
      // When / Then
      assert.ok(ask.includes(`${tool}(${path})`), `${tool}(${path})`);
    }
  }
});

test('given settings.json, when parsed, then allow has none of the four git commands and ask has them', () => {
  for (const tool of TOOLS) {
    for (const command of FOUR) {
      // When
      const allowed = coveredBy(allow, tool, command);
      const asked = coveredBy(ask, tool, command);

      // Then
      assert.deepEqual(allowed, [], `${tool}: ${command} allowed by ${allowed}`);
      assert.ok(asked.length > 0, `${tool}: ${command} not asked`);
    }
  }
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
