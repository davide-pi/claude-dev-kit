import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const { evaluate } = createRequire(import.meta.url)('../hooks/lib/guard.js');
const decide = (tool_name, command, cwd = 'C:/repo') => evaluate({ tool_name, tool_input: { command }, cwd, session_id: 's1' })?.decision ?? 'pass';

test('given a kit folder that is a git repo, when rm -f removes a file in it, then the guard asks', () => {
  // Given
  const home = mkdtempSync(join(tmpdir(), 'fakehome-'));
  const kit = join(home, '.claude');
  mkdirSync(join(kit, '.git'), { recursive: true });
  writeFileSync(join(kit, 'settings.json'), '{}');
  process.env.USERPROFILE = home;
  process.env.HOME = home;

  // When
  const decision = decide('Bash', 'rm -f settings.json', kit);
  rmSync(home, { recursive: true, force: true });

  // Then
  assert.equal(decision, 'ask');
});

test('given a home that is a git repo, when rm -f removes a file under .claude, then the guard asks', () => {
  // Given
  const home = mkdtempSync(join(tmpdir(), 'fakehome-'));
  mkdirSync(join(home, '.git'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), '{}');
  process.env.USERPROFILE = home;
  process.env.HOME = home;

  // When
  const decision = decide('Bash', 'rm -f .claude/settings.json', home);
  rmSync(home, { recursive: true, force: true });

  // Then
  assert.equal(decision, 'ask');
});

function inWorktree(commands) {
  const home = mkdtempSync(join(tmpdir(), 'fakehome-'));
  const tree = mkdtempSync(join(tmpdir(), 'worktree-'));
  mkdirSync(join(tree, '.git'));
  writeFileSync(join(tree, 'a.txt'), 'a');
  writeFileSync(join(tree, 'b.txt'), 'b');
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  try {
    return commands.map((command) => [command, decide('Bash', command, tree)]);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(tree, { recursive: true, force: true });
  }
}

test('given a step before rm -f that is not a delete, an assignment or a listing, when the guard evaluates the line, then it asks', () => {
  // Given
  const commands = ['git checkout other -- .; rm -f a.txt', 'mv b.txt a.txt && rm -f a.txt'];

  // When
  const results = inWorktree(commands);

  // Then
  for (const [command, decision] of results) assert.equal(decision, 'ask', command);
});

test('given rm -f of existing worktree files alone or after an assignment or another rm, when the guard evaluates the line, then it passes', () => {
  // Given
  const commands = ['rm -f a.txt b.txt', 'X=1; rm -f a.txt', 'rm -f a.txt; rm -f b.txt'];

  // When
  const results = inWorktree(commands);

  // Then
  for (const [command, decision] of results) assert.equal(decision, 'pass', command);
});
