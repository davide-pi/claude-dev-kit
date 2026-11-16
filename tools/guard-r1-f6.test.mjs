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
