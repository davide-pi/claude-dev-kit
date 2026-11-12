/**
 * Usage-pace hook: PreToolUse (shell, Agent, Task, Workflow), UserPromptSubmit, SessionStart (resume, compact) and
 * PreCompact. Tells a chat or an agent when the 5h or 7d window crosses a band, denies a new flow from 92% and
 * carries the checkpoint path through a resume or a compaction. Decisions live in lib/usage-pace.js.
 *
 * Fails open: any error prints nothing and exits 0.
 */

'use strict';

const fs = require('fs');
const { CONFIG_DIR } = require('./lib/cache');
const { readPace } = require('../statusline/pace');
const { plan, markCompacted } = require('./lib/usage-pace');
const { armFire, isSub } = require('./lib/fire-log');

const fire = armFire('pace', 'PreToolUse');

try {
  const raw = fs.readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : null;
  if (input) { fire.event = input.hook_event_name || fire.event; fire.sub = isSub(input); }
  const now = Date.now();
  const out = input && plan(input, { now, pace: readPace(), configDir: CONFIG_DIR });
  if (input && input.hook_event_name === 'PreCompact' && input.session_id) markCompacted(CONFIG_DIR, input.session_id, now);
  if (out) fire.decision = out.json?.hookSpecificOutput?.permissionDecision || 'context';
  if (out && out.json) process.stdout.write(JSON.stringify(out.json));
  else if (out && out.text) process.stdout.write(out.text);
} catch { /* fail open */ }
process.exit(0);
