import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { evaluate } = createRequire(import.meta.url)('../hooks/lib/guard.js');
const decide = (tool_name, command, cwd = 'C:/repo') => evaluate({ tool_name, tool_input: { command }, cwd, session_id: 's1' })?.decision ?? 'pass';

test('given a heredoc body that npm exec runs, when the guard reads it, then it asks', () => {
  // Given
  const commands = [
    "npm exec bash <<'EOF'\nrm -rf /tmp/x/y\nEOF",
    "cat > f.sh <<'EOF'\nrm -rf /x/y\nEOF\nnpm exec -- ./f.sh",
    "cat > f.sh <<'EOF'\nrm -rf /x/y\nEOF\nnpm run x -- ./f.sh",
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});
