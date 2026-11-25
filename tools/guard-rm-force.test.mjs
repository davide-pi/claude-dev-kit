import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
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

function inProject(projectFiles, runs) {
  const tree = mkdtempSync(join(tmpdir(), 'project-'));
  mkdirSync(join(tree, '.git'));
  for (const file of projectFiles) writeFileSync(join(tree, file), '');
  for (const folder of ['node_modules', 'dist', 'bin', 'obj', 'src']) mkdirSync(join(tree, folder));
  try {
    return runs.map(([tool, command]) => [command, decide(tool, command, tree)]);
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}

test('given a recursive delete whose every target is a build folder beside its project file, when the guard evaluates it, then it passes', () => {
  // Given
  const runs = [
    ['Bash', 'rm -rf node_modules'], ['Bash', 'rm -rf dist'], ['Bash', 'rm -rf ./bin obj'], ['Bash', 'rm -rf node_modules/'],
    ['Bash', 'X=1; rm -rf dist'], ['PowerShell', 'Remove-Item -Recurse -Force .\\bin'], ['PowerShell', 'Remove-Item -Recurse -Force node_modules'],
  ];

  // When
  const results = inProject(['package.json', 'App.csproj'], runs);

  // Then
  for (const [command, decision] of results) assert.equal(decision, 'pass', command);
});

test('given a build folder holding a link to a source folder, when it is deleted recursively, then the guard asks; without a link it passes', () => {
  // Given
  const tree = mkdtempSync(join(tmpdir(), 'project-'));
  mkdirSync(join(tree, '.git'));
  writeFileSync(join(tree, 'package.json'), '{}');
  mkdirSync(join(tree, 'pkg'));
  mkdirSync(join(tree, 'node_modules'));
  symlinkSync(join(tree, 'pkg'), join(tree, 'node_modules', 'pkg'), 'junction');
  const linked = [['Bash', 'rm -rf node_modules'], ['PowerShell', 'Remove-Item -Recurse -Force node_modules'], ['Bash', 'rd /s /q node_modules']];

  // When
  const withLink = linked.map(([tool, command]) => [command, decide(tool, command, tree)]);
  rmSync(join(tree, 'node_modules', 'pkg'), { recursive: false, force: true });
  mkdirSync(join(tree, 'node_modules', 'plain'));
  const withoutLink = decide('Bash', 'rm -rf node_modules', tree);
  rmSync(tree, { recursive: true, force: true });

  // Then
  for (const [command, decision] of withLink) assert.equal(decision, 'ask', command);
  assert.equal(withoutLink, 'pass');
});

test('given a recursive delete that leaves the working directory or names more than a build folder, when the guard evaluates it, then it asks', () => {
  // Given
  const commands = [
    'rm -rf ../node_modules', 'rm -rf /node_modules', 'rm -rf node_modules/../src', 'rm -rf $X/dist', 'rm -rf dist src',
    'rm -rf node_modules*', 'rm -rf ~/dist', 'cd /elsewhere && rm -rf dist', 'rm -rf C:/dist', 'rm -rf src/bin',
  ];

  // When
  const results = inProject(['package.json', 'App.csproj'], commands.map((command) => ['Bash', command]));

  // Then
  for (const [command, decision] of results) assert.equal(decision, 'ask', command);
});

test('given a folder with no project file that rebuilds the target, when a build-folder name is deleted recursively, then the guard asks', () => {
  // Given
  const commands = ['rm -rf bin', 'rm -rf obj', 'rm -rf node_modules', 'rm -rf dist'];

  // When
  const noProject = inProject([], commands.map((command) => ['Bash', command]));
  const nodeOnly = inProject(['package.json'], [['Bash', 'rm -rf bin'], ['Bash', 'rm -rf node_modules bin']]);
  const outsideAnyFolder = commands.map((command) => [command, decide('Bash', command)]);

  // Then
  for (const [command, decision] of [...noProject, ...nodeOnly, ...outsideAnyFolder]) assert.equal(decision, 'ask', command);
});

test('given rm -f of existing worktree files alone or after an assignment or another rm, when the guard evaluates the line, then it passes', () => {
  // Given
  const commands = ['rm -f a.txt b.txt', 'X=1; rm -f a.txt', 'rm -f a.txt; rm -f b.txt'];

  // When
  const results = inWorktree(commands);

  // Then
  for (const [command, decision] of results) assert.equal(decision, 'pass', command);
});
