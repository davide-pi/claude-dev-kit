/**
 * SubagentStart hook: hand every subagent the same `Lang:` line the main session got at SessionStart
 * (workspace-context.js), resolved for the cwd in the payload. Pure file reads, no network.
 * Any error: silent, exit 0.
 */
const fs = require('fs');

const { resolveDir, langLine } = require('./lib/workspaces');
const { armFire } = require('./lib/fire-log');

const fire = armFire('subagent-lang', 'SubagentStart');

const LARGE_READ = 'A persisted tool output, a transcript or a text file over 256 KB is never read whole: Grep it, or Read it with offset and limit.';

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  fire.sub = true;
  fire.decision = 'context';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: `${langLine(resolveDir(input.cwd))}\n${LARGE_READ}` },
  }));
} catch {
  // never block a subagent start
}
process.exit(0);
