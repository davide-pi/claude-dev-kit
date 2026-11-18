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

// The report shape: every subagent's last message lands whole in the main session's context.
const REPORT = "Your final message is read by the main session, which pays for every word: line 1 is the answer or outcome; then only what it'll act on, one fact per bullet with its file:line, an unknown as ? <what>: <why>; no narrated steps, restated brief, code or tool output it didn't ask for; at most 15 lines unless the brief or a schema sets the shape.";

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  fire.sub = true;
  fire.decision = 'context';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: `${langLine(resolveDir(input.cwd))}\n${LARGE_READ}\n${REPORT}` },
  }));
} catch {
  // never block a subagent start
}
process.exit(0);
