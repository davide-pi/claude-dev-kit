// Permission-noise class "delete": a Bash `export NAME=literal` before a delete in this session's scratchpad.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const { evaluate } = createRequire(import.meta.url)('../hooks/lib/guard.js');
const SESSION = 'noise-sess-own';
const decide = (tool_name, command, session_id = SESSION) => evaluate({ tool_name, tool_input: { command }, cwd: 'C:/repo', session_id })?.decision ?? 'pass';

const project = join(tmpdir(), 'claude', 'noise-delete-proj');
mkdirSync(join(project, SESSION, 'scratchpad'), { recursive: true });
mkdirSync(join(project, 'noise-sess-other', 'scratchpad'), { recursive: true });
after(() => rmSync(project, { recursive: true, force: true }));
const scratchpad = (session = SESSION) => `${tmpdir().replace(/\\/g, '/')}/claude/noise-delete-proj/${session}/scratchpad`;

test('given cd into this session scratchpad and export of a literal, when rm -rf deletes a relative folder, then the guard does not ask', () => {
  // Given
  const dir = scratchpad();
  const commands = [`cd ${dir}; export MSYS_NO_PATHCONV=1; rm -rf rel`, `cd "${dir}" && export N="v" && rm -rf rel`];

  // When
  const results = commands.map((command) => [command, decide('Bash', command)]);

  // Then
  for (const [command, decision] of results) assert.equal(decision, 'pass', command);
});

test('given export of a substitution, a backtick value or a reserved variable, when rm -rf follows in the scratchpad, then the guard asks', () => {
  // Given
  const dir = scratchpad();
  const exports = ['export P=$(pwd)', 'export P=`pwd`', 'export PATH=/x', 'export BASH_ENV=/x', 'export IFS=/'];

  // When
  const results = exports.map((step) => [step, decide('Bash', `cd ${dir}; ${step}; rm -rf rel`)]);

  // Then
  for (const [step, decision] of results) assert.equal(decision, 'ask', step);
});

test('given export -f, export -n or an export of two names, when rm -rf follows in the scratchpad, then the guard asks', () => {
  // Given
  const dir = scratchpad();
  const exports = ['export -f fn', 'export -n N', 'export A=1 B=2'];

  // When
  const results = exports.map((step) => [step, decide('Bash', `cd ${dir}; ${step}; rm -rf rel`)]);

  // Then
  for (const [step, decision] of results) assert.equal(decision, 'ask', step);
});

test('given export N=v joined to the delete by a pipe, a background or an or, when the guard evaluates it, then it asks', () => {
  // Given
  const dir = scratchpad();
  const joins = ['|', '&', '||'];

  // When
  const results = joins.map((sep) => [sep, decide('Bash', `cd ${dir}; export N=v ${sep} rm -rf rel`)]);

  // Then
  for (const [sep, decision] of results) assert.equal(decision, 'ask', sep);
});

test('given PowerShell, when export precedes a recursive delete in the scratchpad, then the guard asks', () => {
  // Given
  const command = `Set-Location ${scratchpad()}; export N=v; Remove-Item -Recurse -Force rel`;

  // When
  const decision = decide('PowerShell', command);

  // Then
  assert.equal(decision, 'ask');
});

test('given the scratchpad of another session and a session id in the payload, when export and rm -rf run there, then the guard asks', () => {
  // Given
  const command = `cd ${scratchpad('noise-sess-other')}; export MSYS_NO_PATHCONV=1; rm -rf rel`;

  // When
  const decision = decide('Bash', command, SESSION);

  // Then
  assert.equal(decision, 'ask');
});

test('given a variable set by a sourced script, when the guard evaluates the line, then it asks', () => {
  // Given
  const commands = ['source ./vars.sh; rm -rf "$SP"', '. ./vars.sh; rm -rf "$SP"'];

  // When
  const results = commands.map((command) => [command, decide('Bash', command)]);

  // Then
  for (const [command, decision] of results) assert.equal(decision, 'ask', command);
});
