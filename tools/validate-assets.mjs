/**
 * tools/validate.mjs rules: settings.json and the front matter of agents, commands, skills and rules (sections 1-2).
 * Called once by validate.mjs with the shared context; returns what later rules and the report read.
 */

import { basename } from 'node:path';

export function checkAssets({ fail, warn, read, has, allFiles, frontMatter }) {
  // ── 1. JSON parses, and settings.json points at things that exist ─────────────
  const HOOK_EVENTS = [
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'PermissionRequest', 'PermissionDenied',
    'UserPromptSubmit', 'UserPromptExpansion', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop',
    'TaskCreated', 'TaskCompleted', 'TeammateIdle', 'SessionStart', 'SessionEnd', 'Setup', 'InstructionsLoaded',
    'ConfigChange', 'CwdChanged', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove', 'PreCompact', 'PostCompact',
    'Elicitation', 'ElicitationResult',
  ];
  let settings = null;
  for (const rel of allFiles.filter((f) => f.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(read(rel));
      if (rel === 'settings.json') settings = parsed;
    } catch (e) {
      fail(rel, `is not valid JSON — ${e.message}`);
    }
  }

  if (settings) {
    for (const event of Object.keys(settings.hooks ?? {})) {
      if (!HOOK_EVENTS.includes(event)) fail('settings.json', `hook event '${event}' is not a known event (a typo means the hook never fires)`);
    }
    const hookEvents = Object.values(settings.hooks ?? {}).flat();
    for (const group of hookEvents) {
      // An absent, empty or "*" matcher means every tool; anything else is compiled as a regex.
      if (group.matcher && group.matcher !== '*') {
        try { new RegExp(group.matcher); } catch (e) { fail('settings.json', `hook matcher '${group.matcher}' is not a valid regex — ${e.message}`); }
      }
      for (const hook of group.hooks ?? []) {
        const line = [hook.command, ...(hook.args ?? [])].join(' ');
        // Hook scripts are resolved through CLAUDE_HOOKS (PowerShell `$env:CLAUDE_HOOKS\x.ps1`, or
        // Node `process.env.CLAUDE_HOOKS + '/x.js'`) — whatever the form, the file must exist.
        if (line.includes('CLAUDE_HOOKS')) {
          const scripts = [...line.matchAll(/([\w.-]+\.(?:ps1|js|mjs|cjs))/g)].map((m) => m[1]);
          if (!scripts.length) fail('settings.json', 'a hook uses CLAUDE_HOOKS but names no script file');
          for (const script of scripts) {
            if (!has(`hooks/${script}`)) {
              fail('settings.json', `hook references hooks/${script}, which is not in the repo`);
            }
          }
        }
        if (!hook.command) fail('settings.json', `a ${group.matcher ?? '?'} hook has no command`);
      }
    }

    const statusLine = settings.statusLine?.command ?? '';
    for (const m of statusLine.matchAll(/([\w.-]+\.js)/g)) {
      if (!has(m[1])) fail('settings.json', `statusLine points at ${m[1]}, which is not in the repo`);
    }

    // Enabled plugins must be documented, or a fresh machine silently lacks them.
    const readme = read('README.md');
    // `false` is an explicit opt-out (the README says why), not an install requirement.
    for (const [name, on] of Object.entries(settings.enabledPlugins ?? {})) {
      if (on !== true) continue;
      const short = name.split('@')[0];
      if (!new RegExp(`/plugin install ${short}\\b`).test(readme)) {
        fail('README.md', `plugin '${short}' is enabled in settings.json but has no install step documented`);
      }
    }
  }

  // ── 2. Front matter of agents and skills ──────────────────────────────────────
  // Every description of a skill and agent is loaded into every session's listing, so they share one
  // budget: a description that grows pushes the others out of view. Collected below, checked once
  // both kinds are read.
  // Only listed descriptions are paid every turn: agents, and skills that are neither `disable-model-invocation`
  // nor gated by `paths:`. The budget is skill-forge's: ~1 % of a 200 k window, in characters.
  const descriptionBudget = [];
  const hiddenDescriptions = [];
  const DESCRIPTION_BUDGET_CHARS = 8000;
  const DESCRIPTION_MAX_CHARS = 1536;  // skill-forge's per-description limit
  const SKILL_DESCRIPTION_WORDS = 25;
  const words = (text) => text.split(/\s+/).filter(Boolean).length;

  const TOOLS = new Set([
    'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Glob', 'Grep', 'LSP', 'Skill', 'Agent', 'Task',
    'WebFetch', 'WebSearch', 'TodoWrite', 'AskUserQuestion', 'Monitor', 'ToolSearch', 'SendMessage', 'BashOutput', 'KillShell',
    'TaskOutput', 'TaskStop', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'EnterPlanMode', 'ExitPlanMode',
    'ListMcpResources', 'ReadMcpResource', 'Workflow', 'SubagentHandback',
  ]);
  const AGENT_MODELS = ['sonnet', 'opus', 'haiku', 'fable', 'inherit'];
  const agentNames = new Set();

  for (const rel of allFiles.filter((f) => f.startsWith('agents/') && f.endsWith('.md'))) {
    const fm = frontMatter(rel);
    if (!fm) { fail(rel, 'has no front matter'); continue; }
    const expected = basename(rel, '.md');
    if (!fm.name) fail(rel, 'front matter has no `name`');
    else if (fm.name !== expected) fail(rel, `front-matter name '${fm.name}' does not match the filename '${expected}'`);
    else agentNames.add(fm.name);
    if (!fm.description) fail(rel, 'front matter has no `description` — the Agent tool needs it to pick the agent');
    else {
      descriptionBudget.push([rel, fm.description]);
      if (fm.description.length < 40) warn(rel, 'description is very short; agent selection depends on it');
    }
    if (fm.model && !AGENT_MODELS.includes(fm.model)) fail(rel, `model '${fm.model}' is not one of ${AGENT_MODELS.join(', ')}`);
    if (fm.tools !== undefined && fm.tools.trim() === '') fail(rel, '`tools` is present but empty — the agent would have no tools');
    for (const tool of (fm.tools ?? '').split(',').map((t) => t.trim().replace(/\(.*$/, '')).filter(Boolean)) {
      if (!tool.startsWith('mcp__') && !TOOLS.has(tool)) fail(rel, `tool '${tool}' is not a known tool name (an unknown name is silently ignored)`);
    }

    // The contract line and the output section are what let a caller merge several agents' reports
    // without reading the prompt; `memory` is a place the agent writes to, so it needs a write tool.
    const agentText = read(rel);
    if (!/^\*\*Contract\.\*\*/m.test(agentText)) fail(rel, 'has no `**Contract.**` line after the title');
    if (!/^(?:## |\*\*)Output\b/m.test(agentText)) {
      fail(rel, "has no '## Output' section (or '**Output**' line) — the output contract is part of the agent");
    }
    if (fm.memory && fm.tools !== undefined && !/\b(?:Write|Edit)\b/.test(fm.tools)) {
      fail(rel, `declares memory '${fm.memory}' but no Write or Edit tool to keep it with`);
    }

    // A whitelisted MCP tool only exists if its plugin is enabled — otherwise the agent silently
    // loses that capability (Claude Code names plugin tools mcp__plugin_<plugin>_<server>__<tool>).
    const enabled = Object.entries(settings?.enabledPlugins ?? {})
      .filter(([, on]) => on === true).map(([p]) => p.split('@')[0]);
    for (const m of (fm.tools ?? '').matchAll(/mcp__plugin_([\w-]+?)_([\w-]+)__([\w]+)/g)) {
      if (!enabled.includes(m[1])) fail(rel, `declares tool from plugin '${m[1]}', which is not enabled in settings.json`);
    }
  }

  // Commands were merged into skills: a `commands/` folder would shadow-collide with them.
  for (const rel of allFiles.filter((f) => f.startsWith('commands/'))) {
    fail(rel, 'commands/ no longer exists — a slash command is a skills/<name>/SKILL.md');
  }

  // Skills whose contract is "explicit trigger only": the description must say so, or the
  // model will fire them on its own.
  // They must also carry `disable-model-invocation: true`, the only switch that really keeps them out
  // of the model's hands — a description saying "explicit trigger only" is a request, not a lock.
  // grill-me is not here: it fires on natural phrasing ("poke holes in this").
  // Named with a slash in the description on purpose, yet invocable by the model: `/code-review` is also
  // what "review this" resolves to (CLAUDE.md routes every review through it). `grill-me` is meant to
  // trigger from natural language (owner decision, eval r2), so it stays model-invocable too. `worklog`
  // fires when the owner asks in prose to log hours (owner decision): its two confirmation gates guard the write.
  const MODEL_INVOCABLE_BY_DESIGN = new Set(['code-review', 'grill-me', 'worklog']);
  const EXPLICIT_TRIGGER = [
    'docs-sync', 'retro',
  ];
  for (const rel of allFiles.filter((f) => f.startsWith('skills/') && f.endsWith('/SKILL.md'))) {
    const fm = frontMatter(rel);
    const dir = rel.split('/')[1];
    if (!fm) { fail(rel, 'has no front matter'); continue; }
    if (!fm.name) fail(rel, 'front matter has no `name`');
    else if (fm.name !== dir) fail(rel, `front-matter name '${fm.name}' does not match the directory '${dir}'`);
    if (!fm.description) fail(rel, 'front matter has no `description` — skills trigger from it');
    else {
      if (fm.description.length > DESCRIPTION_MAX_CHARS) fail(rel, `description is ${fm.description.length} chars; keep it under ${DESCRIPTION_MAX_CHARS}`);
      if (EXPLICIT_TRIGGER.includes(dir) && !new RegExp(`/${dir}\\b`).test(fm.description)) {
        fail(rel, `is trigger-only but its description never names /${dir}, so it can fire unasked`);
      }
      if (words(fm.description) > SKILL_DESCRIPTION_WORDS) {
        fail(rel, `description is ${words(fm.description)} words; keep it to ${SKILL_DESCRIPTION_WORDS} — say when, not what`);
      }
      if (!/^Use when\b/.test(fm.description)) fail(rel, 'description must open with `Use when` — it is a trigger, not a summary');
      if (fm['disable-model-invocation'] === 'true' || fm.paths) hiddenDescriptions.push([rel, fm.description]);
      else descriptionBudget.push([rel, fm.description]);
    }
    if (EXPLICIT_TRIGGER.includes(dir) && fm['disable-model-invocation'] !== 'true') {
      fail(rel, 'is trigger-only but lacks `disable-model-invocation: true`, so the model can still invoke it');
    }
    // A description that names `/<name>` reads as "only when typed": without the flag the skill is still
    // listed on every turn (bytes paid) and still fires on prose. Warn, so a deliberate exception shows.
    if (fm.description && new RegExp(`/${dir}\\b`).test(fm.description) && fm['disable-model-invocation'] !== 'true'
        && !EXPLICIT_TRIGGER.includes(dir) && !MODEL_INVOCABLE_BY_DESIGN.has(dir)) {
      warn(rel, `description names /${dir} but the skill lacks \`disable-model-invocation: true\` — still listed every turn and invocable by the model`);
    }
  }

  // Rules load on touch through `paths`, which Claude Code reads as one comma-separated string: a
  // YAML list was silently ignored on earlier builds, leaving the rule loaded never (or always).
  const RULE_LINES = 25;
  for (const rel of allFiles.filter((f) => /^rules\/[\w.-]+\.md$/.test(f))) {
    const text = read(rel);
    const head = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!head) { fail(rel, 'has no front matter — a rule without `paths` loads every session like CLAUDE.md'); continue; }
    const paths = head[1].match(/^paths:[ \t]*(.*)$/m);
    if (!paths) fail(rel, 'front matter has no `paths`');
    else if (!/^"[^"]+"$/.test(paths[1].trim())) {
      fail(rel, '`paths` must be one quoted comma-separated string ("a,b"), not a YAML list or a bare value');
    }
    const lines = text.replace(/\n$/, '').split('\n').length;
    if (lines > RULE_LINES) fail(rel, `${lines} lines against the ${RULE_LINES}-line cap for a rule — facts only, procedure in the skill`);
  }

  const hiddenTotal = hiddenDescriptions.reduce((sum, [, d]) => sum + d.length, 0);
  const descriptionTotal = descriptionBudget.reduce((sum, [, d]) => sum + d.length, 0);
  if (descriptionTotal > DESCRIPTION_BUDGET_CHARS) {
    const top = [...descriptionBudget].sort((a, b) => b[1].length - a[1].length).slice(0, 5)
      .map(([rel, d]) => `${rel} (${d.length})`).join(', ');
    fail('descriptions', `listed skills + agents total ${descriptionTotal} chars against a budget of ${DESCRIPTION_BUDGET_CHARS}. Largest: ${top}`);
  }

  return { descriptionBudget, hiddenDescriptions, DESCRIPTION_BUDGET_CHARS, AGENT_MODELS, agentNames, hiddenTotal, descriptionTotal };
}
