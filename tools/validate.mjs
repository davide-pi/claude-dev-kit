#!/usr/bin/env node
/**
 * Validates the kit without installing it. Zero dependencies — plain Node 18+.
 *
 *   node tools/validate.mjs
 *
 * Exits 1 on any ERROR, 0 when only WARNs remain. Every check exists because something
 * actually broke this way: an asset referenced from settings.json but never committed, a
 * machine-specific path in a public repo, a plugin enabled but undocumented.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// VALIDATE_ROOT lets tools/validate.test.mjs run the rules against a fixture tree.
const ROOT = process.env.VALIDATE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const has = (rel) => existsSync(join(ROOT, rel));

/** Every tracked text file, repo-relative with forward slashes. */
function walk(dir = '', out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (['.git', 'node_modules', '.remember', '.claude'].includes(entry.name)) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (rel === 'evals/results') continue; // untracked run output of `claude plugin eval`
    if (rel === 'tools/fixtures/validate') continue; // deliberately small kits for validate.test.mjs
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}
const allFiles = walk();
const textFiles = allFiles.filter((f) => /\.(md|json|js|mjs|ts|tsx|ps1|yml|yaml)$/.test(f));

/** Minimal front-matter reader: the `---` block at the top of a markdown file. */
function frontMatter(rel) {
  const text = read(rel);
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return null;
  const block = text.slice(4, end);
  const fields = {};
  let currentKey = null;
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (m) {
      currentKey = m[1];
      // Drop a block-scalar marker (`>`, `>-`, `|`, `|-`): it is YAML syntax, not part of the value,
      // and leaving it in made every folded description validate as ">- Branching conventions…".
      fields[currentKey] = m[2].trim().replace(/^[>|][-+]?\s*$/, '');
    } else if (currentKey && line.trim()) {
      // folded scalar (`description: >-`) or continuation
      fields[currentKey] = `${fields[currentKey]} ${line.trim()}`.trim();
    }
  }
  return fields;
}

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
  'workitem-create', 'pr-review', 'items-qa', 'project-wiki-standard',
  'docs-sync', 'retro', 'estimate',
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

// ── 3. Nothing machine-specific or secret ────────────────────────────────────
const LEAKS = [
  // Case-insensitive on purpose: `c:\users\…` must not slip past a capitalised pattern.
  [/[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!<)[A-Za-z0-9._-]+/gi, 'absolute user path'],
  [/\/(?:home|Users)\/(?!<)[A-Za-z][A-Za-z0-9._-]{2,}/gi, 'absolute home path'],
  // Any other absolute Windows path names a machine's layout (a workspace root, a worktree root).
  // System paths are allowed below; a path with a <placeholder> segment is the way to write one.
  [/\b[A-Za-z]:(?![\\/]{1,2}(?:Program Files|Users)\b)[\\/]{1,2}[A-Za-z_][\w.-]+[^\s"'`|*]*/gi, 'absolute Windows path'],
  // An MCP server alias is an organization's name: only a placeholder or a wildcard may stand there.
  [/mcp__azdo-(?![<*{])[A-Za-z0-9]\w*/gi, 'MCP server alias (use <org-alias>)'],
  // `git@host` in a clone URL is not an address; neither is anything at example.*
  [/(?<!git)(?<![\w.+-])[\w.+-]+@(?!example\.|ssh\.)[\w-]+\.[a-z]{2,}/gi, 'e-mail address'],
  // Hyphen-segmented provider keys (sk-ant-api03-…, sk-proj-…) are the ones most likely to be
  // pasted into a Claude Code config repo, so they must match as well as the legacy flat form.
  [/\b(?:glsa_|ghp_|github_pat_|gho_|ghs_|ghu_|xoxb-|xoxp-|xapp-)[A-Za-z0-9_-]{8,}/g, 'token-shaped string'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS access key id'],
  [/\bsk-(?:ant|proj|live|test)?-?[A-Za-z0-9_-]{20,}/g, 'API-key-shaped string'],
  // `|` excluded from the value: a search pattern hunting for leaked secrets reads
  // `Password=|Pwd=|Secret`, and a real password value never starts with an alternation.
  [/\b(?:Password|Pwd)\s*=\s*(?!<)[^;'"\s|]{3,}/gi, 'password in a connection string'],
];
// Allowed: the MIT line, and documented Windows system paths.
const LEAK_ALLOW = [
  /Davide Piccinini/,                                   // the LICENSE holder, on purpose
  /C:\\Program Files\\PowerShell/,                      // documented system path
  /C:\\Users\\<[^>]+>/,                                 // explicit placeholder
  /^[A-Za-z]:[\\/]{1,2}[^<]*<[^>]+>/,                   // a path with a <placeholder> segment
  /^C:\\{1,2}db\\{1,2}x/,                                 // the sample in destructive.js's comment
  // A password that is a *reference* to a secret, or an obvious stand-in, is the correct way to
  // write an example — flagging it would push authors towards vaguer, less useful examples.
  /(?:Password|Pwd)\s*=\s*(?:\$env:|\$\{|%[A-Za-z_]+%|\$\()/i,
  /(?:Password|Pwd)\s*=\s*(?:changeme|change-me|placeholder|your[-_]?password|secret|xxx+|\*+)\b/i,
];
// A file whose job is to detect credentials has to carry specimens of them. Only these two, and
// only because the specimens are the test surface — never widen this to a directory.
const LEAK_EXEMPT = new Set(['hooks/secret-scan.js', 'tools/secret-scan.test.mjs']);
// Test fixtures write fake drive paths (a drive letter and a made-up folder) to exercise path matching: for them, and only
// for the absolute-path rule, a drive path is the subject under test, not a leak.
const PATH_RULE = 'absolute Windows path';
const isTestFile = (rel) => /^(?:tools\/[\w.-]+\.test\.mjs|mods\/[\w.-]+\/tests\/[\w.-]+\.test\.ts)$/.test(rel);
for (const rel of textFiles) {
  if (LEAK_EXEMPT.has(rel)) continue;
  const text = read(rel);
  for (const [pattern, label] of LEAKS) {
    if (label === PATH_RULE && isTestFile(rel)) continue;
    for (const m of text.matchAll(pattern)) {
      const line = text.slice(0, m.index).split('\n').length;
      const snippet = m[0].length > 60 ? `${m[0].slice(0, 57)}...` : m[0];
      if (LEAK_ALLOW.some((a) => a.test(m[0]))) continue;
      fail(`${rel}:${line}`, `${label}: ${snippet}`);
    }
  }
}

// ── 4. Cross-references resolve ──────────────────────────────────────────────
const REFERENCE = /\b((?:agents|commands|hooks|tools|mcp)\/[\w.-]+\.(?:md|ps1|mjs|json)|skills\/[\w-]+\/[\w.-]+)\b/g;
for (const rel of textFiles) {
  const text = read(rel);
  const textLines = text.split('\n');
  for (const m of text.matchAll(REFERENCE)) {
    if (!has(m[1])) {
      const line = text.slice(0, m.index).split('\n').length;
      // A deliberate pointer at something that no longer exists (install.ps1's list of retired assets).
      if (/retired-ok/.test(textLines[line - 1] ?? '')) continue;
      fail(`${rel}:${line}`, `references ${m[1]}, which does not exist`);
    }
  }
  // Markdown links to local files — markdown only, and only real paths: the skills are full
  // of `[text](url)` templates and `[Task #id](<link>)` placeholders, and .ps1 code trips the
  // same shape (`$p[0].Trim(`).
  if (!rel.endsWith('.md')) continue;
  for (const m of text.matchAll(/\[[^\]]+\]\((?!https?:|#|mailto:)([^)#\s]+)\)/g)) {
    const target = m[1].trim();
    const isPlaceholder = /[<>${}]/.test(target) || !/[/.]/.test(target);
    if (isPlaceholder) continue;
    const line = text.slice(0, m.index).split('\n').length;
    // `../../docs/...` in the project-scoped agents points at the *host* project, not here.
    if (target.startsWith('../')) { warn(`${rel}:${line}`, `link '${target}' resolves outside the repo (host-project reference?)`); continue; }
    const resolved = target.startsWith('/') ? target.slice(1) : join(dirname(rel), target).replace(/\\/g, '/');
    if (!existsSync(join(ROOT, resolved))) fail(`${rel}:${line}`, `broken link to ${target}`);
  }
}

// An agent nobody spawns is dead weight: nothing in the kit would ever reach it, and a rename that
// orphaned it would otherwise pass unnoticed. (The previous version of this check looked for a
// "spawn `x`" phrasing and matched nothing at all in the whole repo — false confidence, removed.)
const prose = textFiles
  .filter((f) => f.endsWith('.md') && !f.startsWith('agents/'))
  .map((f) => read(f))
  .join('\n');
for (const name of agentNames) {
  if (!new RegExp(`\\b${name}\\b`).test(prose)) {
    warn(`agents/${name}.md`, 'no command, skill or doc ever names this agent — nothing can reach it');
  }
}

// The review agents run with `omitClaudeMd` and the main session may skip an external reference, so
// the contract text each reader needs is inlined. The canonical copy lives in report-format.md; a copy
// that drifts makes the merger parse several dialects, so every copy must equal it byte for byte:
//   - the Finding block (fenced) in the 3 review agents;
//   - the one-defect-per-block rule (a paragraph) in the 3 review agents;
//   - the report skeleton (fenced) in the code-review and pr-review skills and the review-large merger.
{
  const FORMAT = 'skills/pr-review/references/report-format.md';
  const norm = (rel) => read(rel).replace(/\r\n/g, '\n');
  const fenced = (patterns, label, copies) => {
    const canonical = has(FORMAT) ? norm(FORMAT).match(patterns)?.[1] : null;
    if (!canonical) { fail(FORMAT, `no canonical ${label}`); return; }
    for (const rel of copies) {
      if (has(rel) && !norm(rel).includes(canonical)) fail(rel, `inline ${label} differs from the one in ${FORMAT} — copy it verbatim`);
    }
  };
  const AGENTS = ['code-reviewer', 'review-security', 'review-performance'].map((n) => `agents/${n}.md`);
  fenced(/## Finding block[\s\S]*?```text\n([\s\S]*?)\n```/, 'Finding block', AGENTS);
  fenced(/(\*\*One defect per block[^\n]*(?:\n[^\n]+)*)/, 'one-defect-per-block rule', AGENTS);
  fenced(/## Order and tables[\s\S]*?```text\n([\s\S]*?)\n```/, 'report skeleton',
    ['skills/code-review/SKILL.md', 'skills/pr-review/SKILL.md', 'workflows/review-large.js']);
}

// ── 4b. Every skill has triggering cases ─────────────────────────
// Descriptions are the only thing that decides whether a skill fires, so an untested one is an
// untested trigger. A warning, not an error: adding the asset should not be blocked by it. Covered
// by an automated suite (`evals/<skill>/<case>/prompt.md`, run by `tools/run-evals.ps1`) or by a
// manual section of `evals/skill-triggering.md`.
if (has('evals/skill-triggering.md')) {
  const evals = read('evals/skill-triggering.md');
  const named = allFiles.filter((f) => f.endsWith('/SKILL.md')).map((f) => f.split('/')[1]);
  const suites = new Set(allFiles.filter((f) => /^evals\/[^/]+\/.+\/prompt\.md$/.test(f)).map((f) => f.split('/')[1]));
  // Look for a heading that names the asset, not a mention anywhere in the file: `/commit` appearing
  // inside another skill's case row used to count as coverage for the commit skill.
  for (const name of new Set(named)) {
    if (suites.has(name)) continue;
    if (!new RegExp(`^#{2,4} .*\\b${name}\\b`, 'm').test(evals)) {
      warn('evals/skill-triggering.md', `no triggering case section or evals/${name}/ suite covers '${name}'`);
    }
  }
  // A suite for a skill that does not exist is a rename that left its cases behind.
  for (const suite of suites) {
    if (!named.includes(suite)) fail(`evals/${suite}`, 'suite has no matching skills/' + suite + '/SKILL.md');
  }
}

// ── 5. Environment variables the kit needs are documented ────────────────────
const SYSTEM_VARS = new Set(['USERPROFILE', 'LOCALAPPDATA', 'HOME', 'TEMP', 'TMP', 'PATH', 'APPDATA', 'COMPUTERNAME', 'CLAUDE_PROJECT_DIR']);
const readme = read('README.md');
const referencedVars = new Set();
for (const rel of textFiles.filter((f) => f.endsWith('.ps1') || f === 'settings.json')) {
  for (const m of read(rel).matchAll(/\$env:([A-Z][A-Z0-9_]{2,})/g)) referencedVars.add(m[1]);
}
for (const name of referencedVars) {
  if (SYSTEM_VARS.has(name)) continue;
  if (!readme.includes(name)) fail('README.md', `environment variable ${name} is used by the kit but not documented`);
}

// ── 6. The v2 asset contract ─────────────────────────────────────────────────
// The design spec under docs/specs/ sets three rules that nothing else can catch: hard line caps
// (a skill needing more text needs a reference file, not a longer SKILL.md), a fixed body
// skeleton, and no version numbers in an asset's prose. One skill is exempt: grill-me is fourteen
// lines of interview instruction, and the skeleton would only pad it. Everything else conforms —
// keep this list at one entry.
const PRE_V2_SKILLS = new Set([]);
const isPreV2 = (rel) => rel.startsWith('skills/') && PRE_V2_SKILLS.has(rel.split('/')[1]);
// wc -l semantics: a trailing newline is a terminator, not an empty final line.
const lineCount = (rel) => read(rel).replace(/\n$/, '').split('\n').length;

const LINE_CAPS = [
  [(f) => f.endsWith('/SKILL.md'), 120, 'SKILL.md'],
  [(f) => /^skills\/[\w-]+\/references\/[\w.-]+\.md$/.test(f), 200, 'reference file'],
];
for (const rel of allFiles.filter((f) => f.endsWith('.md'))) {
  for (const [matches, cap, kind] of LINE_CAPS) {
    if (!matches(rel)) continue;
    const lines = lineCount(rel);
    if (lines <= cap) continue;
    const msg = `${lines} lines against the ${cap}-line cap for a ${kind}`;
    if (isPreV2(rel)) warn(rel, `${msg} — predates the contract, scheduled for the split`);
    else fail(rel, `${msg}. Move the depth into references/, do not delete substance`);
  }
}

// The skeleton is what lets several authors produce assets that read as one kit.
const REQUIRED_SECTIONS = ['When', 'Decide', 'Do', 'Traps'];
for (const rel of allFiles.filter((f) => f.endsWith('/SKILL.md'))) {
  if (isPreV2(rel)) continue;
  const text = read(rel);
  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^##\\s+${section}\\b`, 'm').test(text)) {
      fail(rel, `has no '## ${section}' section — the body skeleton is fixed`);
    }
  }
  // The contract line is what a user-invoked skill has instead of a guardrails section: what it
  // produces · what it never does · the output language, so it is safe to run without reading it.
  const contract = text.match(/^\*\*Contract\.\*\*.*(?:\n.+)*/m)?.[0];
  if (!contract) fail(rel, 'has no `**Contract.**` line after the title');
  else if (contract.split('·').length < 3) fail(rel, 'the contract line is not `produces · never does · language`');
  // "When" without its exclusions is half a trigger: it says what fires the skill and never what
  // does not, which is how a skill ends up answering questions it has no business answering.
  if (!/Not for:/.test(text)) warn(rel, "the 'When' section states no 'Not for:' exclusions");
}

// A reference file the SKILL.md never names can never be opened: it is tokens nobody reads.
for (const rel of allFiles.filter((f) => /^skills\/[\w-]+\/references\/[\w.-]+\.md$/.test(f))) {
  const [, skill, , file] = rel.split('/');
  const skillFile = `skills/${skill}/SKILL.md`;
  if (!has(skillFile)) { fail(rel, `has no ${skillFile} to be reached from`); continue; }
  if (!read(skillFile).includes(file)) fail(rel, `${skillFile} never names it — nothing can open it`);
}

// A version number in an asset rots on a schedule nobody can keep up with. State how to detect
// the version instead (project file, manifest) or route to the docs plugin. Deliberate exceptions
// carry `<!-- version-ok: reason -->` on the same line.
const VERSIONED_TECH = [
  '\\.NET', 'Angular', 'AngularJS', 'React', 'Node', 'TypeScript', 'EF Core', 'Entity Framework',
  'Redis', 'RabbitMQ', 'PostgreSQL', 'Postgres', 'SQL Server', 'xUnit', 'NUnit', 'MSTest', 'Vite',
  'Tailwind', 'RxJS', 'NgRx', 'Aspire', 'Serilog', 'Polly', 'MediatR', 'Npgsql', 'EasyNetQ',
  'StackExchange\\.Redis', 'Vitest', 'Jest', 'Karma', 'Testcontainers', 'OpenTelemetry',
];
const VERSION_PATTERNS = [
  [new RegExp(`\\b(?:${VERSIONED_TECH.join('|')})\\s+v?\\d+(?:\\.\\d+)*\\b`, 'gi'), 'a pinned version'],
  [/\bv\d+\.\d+(?:\.\d+)?\b/g, 'a version-shaped token'],
  [/\b\d+\.\d+\.\d+\b/g, 'a semantic version'],
];
for (const rel of allFiles.filter((f) => f.endsWith('.md') && f.startsWith('skills/'))) {
  if (isPreV2(rel)) continue;
  const text = read(rel);
  const lines = text.split('\n');
  for (const [pattern, label] of VERSION_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const lineNo = text.slice(0, m.index).split('\n').length;
      if (/<!--\s*version-ok:/.test(lines[lineNo - 1] ?? '')) continue;
      fail(`${rel}:${lineNo}`, `${label} (${m[0]}) — say how to detect the version instead`);
    }
  }
}

// An Azure DevOps organization or project name identifies a client, and this repository is public,
// so every URL and every explicit --org value must carry a placeholder instead. Checked apart from
// the leak rules because the shape is specific: a host segment that is not a placeholder.
const ORG_PATTERNS = [
  [/dev\.azure\.com\/(?![<{%]|your-)([A-Za-z0-9._-]{2,})/g, 'an Azure DevOps organization name'],
  [/\b(?![<{])([A-Za-z][A-Za-z0-9-]{1,})\.visualstudio\.com/g, 'an Azure DevOps organization name'],
];
// Words that are stand-ins rather than customers: a comment documenting the URL shape writes `org`
// without angle brackets, and Microsoft's own examples use contoso and fabrikam.
const PLACEHOLDER_ORGS = new Set([
  'org', 'orgname', 'organization', 'myorg', 'yourorg', 'example', 'placeholder',
  'contoso', 'fabrikam', 'tenant',
]);
for (const rel of textFiles) {
  const text = read(rel);
  for (const [pattern, label] of ORG_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      if (PLACEHOLDER_ORGS.has(m[1].toLowerCase())) continue;
      const line = text.slice(0, m.index).split('\n').length;
      fail(`${rel}:${line}`, `${label} (${m[1]}) — use a placeholder such as <org>`);
    }
  }
}

// ── 6b. Relative requires and imports resolve ───────────────────────────────
// A hook that requires a file nobody committed fails at its first run, on a machine that never saw the repo.
// Test files are left out: they carry such specimens as strings.
const RELATIVE_REF = /(?:\brequire\(\s*|\bimport\(\s*|\bfrom\s+|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;
for (const rel of allFiles.filter((f) => /^(?:hooks\/(?:lib\/)?[\w.-]+\.(?:js|cjs|mjs)|tools\/(?![\w.-]*\.test\.mjs)[\w.-]+\.mjs)$/.test(f))) {
  const text = read(rel);
  for (const m of text.matchAll(RELATIVE_REF)) {
    const base = join(dirname(rel), m[1]).replace(/\\/g, '/');
    const ok = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.json`, `${base}/index.js`].some((c) => {
      const abs = join(ROOT, c);
      return existsSync(abs) && statSync(abs).isFile();
    });
    if (!ok) fail(`${rel}:${text.slice(0, m.index).split('\n').length}`, `requires ${m[1]}, which does not resolve`);
  }
}

// ── 6c. Byte caps: what is injected every session or invocation ─────────────
// CLAUDE.md and the output style load every turn; a SKILL.md re-injects on invocation, cut from the bottom.
// BYTE_CAP_WARN_ONLY lists files over a cap whose trim another change owns: they warn until trimmed.
const BYTE_CAPS = [
  [(f) => f === 'CLAUDE.md', 2750, 'CLAUDE.md'],
  [(f) => /^output-styles\/[\w.-]+\.md$/.test(f), 2500, 'an output style'],
  [(f) => /^skills\/[\w-]+\/SKILL\.md$/.test(f), 7000, 'SKILL.md'],
];
const BYTE_CAP_WARN_ONLY = new Set(['CLAUDE.md', 'skills/deliver/SKILL.md']);
for (const rel of allFiles) {
  for (const [matches, cap, kind] of BYTE_CAPS) {
    if (!matches(rel)) continue;
    const bytes = statSync(join(ROOT, rel)).size;
    if (bytes <= cap) continue;
    const msg = `${bytes} bytes against the ${cap}-byte cap for ${kind}`;
    if (BYTE_CAP_WARN_ONLY.has(rel)) warn(rel, `${msg} — scheduled for the trim`);
    else fail(rel, `${msg}. Move depth into references/ or cut restatements`);
  }
}

// ── 7. Saved workflows ───────────────────────────────────────────────────────
// The runtime strips `export` and runs the file as the body of an async function whose parameters are
// the orchestration primitives. So `meta` must be the first statement, the body must compile there,
// and nothing may be non-deterministic or imported: a workflow is replayed, and `Date.now()` or an
// `import` would break the replay or the compile, silently, at the first `/<name>`.
const AsyncFunction = (async () => {}).constructor;
const BUILTIN_AGENTS = ['Explore', 'Plan', 'general-purpose'];
const WORKFLOW_PARAMS = ['args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow'];
for (const rel of allFiles.filter((f) => /^workflows\/[\w.-]+\.js$/.test(f))) {
  const src = read(rel);
  if (!/^export const meta = \{/.test(src)) { fail(rel, '`export const meta = {` must be the first statement'); continue; }
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  if (/\bDate\.now\s*\(|\bnew Date\s*\(|\bMath\.random\s*\(/.test(code)) fail(rel, 'uses Date.now, new Date or Math.random — a workflow must be deterministic');
  if (/^\s*import\s/m.test(code)) fail(rel, 'has an import — the body runs inside a function, where imports do not exist');
  for (const m of code.matchAll(/\bagentType:\s*'([^']+)'/g)) {
    if (!agentNames.has(m[1]) && !BUILTIN_AGENTS.includes(m[1])) fail(rel, `agentType '${m[1]}' is neither agents/${m[1]}.md nor a built-in agent`);
  }
  for (const m of code.matchAll(/\bmodel:\s*'([^']+)'/g)) {
    if (!AGENT_MODELS.includes(m[1])) fail(rel, `model '${m[1]}' is not one of ${AGENT_MODELS.join(', ')}`);
  }
  try {
    new AsyncFunction(...WORKFLOW_PARAMS, src.replace(/^export /, ''));
  } catch (e) {
    fail(rel, `does not compile as a workflow body — ${e.message}`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const label = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
console.log(`descriptions: listed ${descriptionTotal} / ${DESCRIPTION_BUDGET_CHARS} chars (${descriptionBudget.length} agents and skills), hidden ${hiddenTotal} chars (${hiddenDescriptions.length} skills: user-invoked or paths-gated)`);

// In Actions, also emit annotations so findings land on the file and line in the PR view.
if (process.env.GITHUB_ACTIONS) {
  const annotate = (level, entry) => {
    const m = entry.match(/^([^:]+?)(?::(\d+))?: (.*)$/s);
    if (!m) return console.log(`::${level}::${entry}`);
    const line = m[2] ? `,line=${m[2]}` : '';
    console.log(`::${level} file=${m[1]}${line}::${m[3].replace(/\n/g, ' ')}`);
  };
  for (const w of warnings) annotate('warning', w);
  for (const e of errors) annotate('error', e);
}
if (warnings.length) {
  console.log(`\nWARN (${warnings.length})`);
  for (const w of warnings) console.log(`  ${w}`);
}
if (errors.length) {
  console.log(`\nERROR (${errors.length})`);
  for (const e of errors) console.log(`  ${e}`);
  console.log(`\nvalidate: ${label(errors.length, 'error')}, ${label(warnings.length, 'warning')} — ${allFiles.length} files scanned`);
  process.exit(1);
}
console.log(`\nvalidate: clean — ${allFiles.length} files scanned, ${label(warnings.length, 'warning')}`);
