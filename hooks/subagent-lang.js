/**
 * SubagentStart hook: hand every subagent the same `Lang:` line the main session got at SessionStart
 * (workspace-context.js), resolved for the cwd in the payload. Pure file reads, no network.
 * Any error: silent, exit 0.
 */
const fs = require('fs');

const { resolveDir, langLine } = require('./lib/workspaces');

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: langLine(resolveDir(input.cwd)) },
  }));
} catch {
  // never block a subagent start
}
process.exit(0);
