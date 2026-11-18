// Probe A3.1: a read-only agent's git write behind a runner with a long flag or `--` is still denied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function decisionFor(command) {
  const result = spawnSync(process.execPath, [join(root, 'hooks', 'guard-shell.js')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root, agent_id: 'a1', agent_type: 'code-reviewer' }),
    encoding: 'utf8',
  });
  return (result.stdout || '').includes('"deny"') ? 'deny' : 'approve';
}

test('Given a read-only agent, when a runner with `--` or a long flag precedes a git write, then it is denied', () => {
  // Given
  const commands = ['env -- git push origin x', 'xargs -- git commit -m x', 'xargs -- git add .', 'env --ignore-environment git pull', 'sudo --preserve-env git add .', 'xargs --no-run-if-empty git add .', 'env git push'];
  // When
  const decisions = commands.map(decisionFor);
  // Then
  assert.deepEqual(decisions, commands.map(() => 'deny'));
});

test('Given a read-only agent, when az devops invoke passes `--area git`, then it is not denied', () => {
  // Given
  const command = 'az devops invoke --area git --resource refs --http-method GET';
  // When
  const decision = decisionFor(command);
  // Then
  assert.equal(decision, 'approve');
});
