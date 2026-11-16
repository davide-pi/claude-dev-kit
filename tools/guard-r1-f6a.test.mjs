import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const { evaluate } = createRequire(import.meta.url)('../hooks/lib/guard.js');
const decide = (tool_name, command, cwd = 'C:/repo') => evaluate({ tool_name, tool_input: { command }, cwd, session_id: 's1' })?.decision ?? 'pass';

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
