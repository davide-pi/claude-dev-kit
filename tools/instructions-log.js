/**
 * Dev-only InstructionsLoaded hook: appends one JSON line per loaded instruction file (CLAUDE.md,
 * rules/*.md) so a `paths` rule can be seen loading on the file that should trigger it.
 *
 * Wire it in the kit repo's own `.claude/settings.local.json` (never the template):
 *   "InstructionsLoaded": [{ "hooks": [{ "type": "command",
 *     "command": "node \"$CLAUDE_PROJECT_DIR/tools/instructions-log.js\"" }] }]
 *
 * Log: INSTRUCTIONS_LOG, else `<config>/.cache/instructions.log`. Never blocks: exit 0 always.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const log = process.env.INSTRUCTIONS_LOG || path.join(config, '.cache', 'instructions.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.appendFileSync(log, `${JSON.stringify({
    at: new Date().toISOString(),
    file: input.file_path,
    load_reason: input.load_reason,
    trigger: input.trigger_file_path,
    memory_type: input.memory_type,
  })}\n`);
} catch {
  // a logger must never break a session
}
process.exit(0);
