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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}
const allFiles = walk();
const textFiles = allFiles.filter((f) => /\.(md|json|js|mjs|ps1|yml|yaml)$/.test(f));

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
  const hookEvents = Object.values(settings.hooks ?? {}).flat();
  for (const group of hookEvents) {
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
  for (const name of Object.keys(settings.enabledPlugins ?? {})) {
    const short = name.split('@')[0];
    if (!new RegExp(`/plugin install ${short}\\b`).test(readme)) {
      fail('README.md', `plugin '${short}' is enabled in settings.json but has no install step documented`);
    }
  }
}

// ── 2. Front matter of agents, commands and skills ────────────────────────────
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
  else if (fm.description.length < 40) warn(rel, 'description is very short; agent selection depends on it');
  if (fm.model && !AGENT_MODELS.includes(fm.model)) fail(rel, `model '${fm.model}' is not one of ${AGENT_MODELS.join(', ')}`);
  if (fm.tools !== undefined && fm.tools.trim() === '') fail(rel, '`tools` is present but empty — the agent would have no tools');

  // A whitelisted MCP tool only exists if its plugin is enabled — otherwise the agent silently
  // loses that capability (Claude Code names plugin tools mcp__plugin_<plugin>_<server>__<tool>).
  const enabled = Object.keys(settings?.enabledPlugins ?? {}).map((p) => p.split('@')[0]);
  for (const m of (fm.tools ?? '').matchAll(/mcp__plugin_([\w-]+?)_([\w-]+)__([\w]+)/g)) {
    if (!enabled.includes(m[1])) fail(rel, `declares tool from plugin '${m[1]}', which is not enabled in settings.json`);
  }
}

for (const rel of allFiles.filter((f) => f.startsWith('commands/') && f.endsWith('.md'))) {
  const fm = frontMatter(rel);
  if (!fm) { fail(rel, 'has no front matter'); continue; }
  if (!fm.description) fail(rel, 'front matter has no `description` — the slash command needs one');
}

// Skills whose contract is "explicit trigger only": the description must say so, or the
// model will fire them on its own.
const EXPLICIT_TRIGGER = ['worklog', 'workitem-create', 'pr-review', 'items-qa'];
for (const rel of allFiles.filter((f) => f.startsWith('skills/') && f.endsWith('/SKILL.md'))) {
  const fm = frontMatter(rel);
  const dir = rel.split('/')[1];
  if (!fm) { fail(rel, 'has no front matter'); continue; }
  if (!fm.name) fail(rel, 'front matter has no `name`');
  else if (fm.name !== dir) fail(rel, `front-matter name '${fm.name}' does not match the directory '${dir}'`);
  if (!fm.description) fail(rel, 'front matter has no `description` — skills trigger from it');
  else {
    if (fm.description.length > 1024) fail(rel, `description is ${fm.description.length} chars; keep it under 1024`);
    if (EXPLICIT_TRIGGER.includes(dir) && !new RegExp(`/${dir}\\b`).test(fm.description)) {
      fail(rel, `is trigger-only but its description never names /${dir}, so it can fire unasked`);
    }
  }
}

// ── 3. Nothing machine-specific or secret ────────────────────────────────────
const LEAKS = [
  // Case-insensitive on purpose: `c:\users\…` must not slip past a capitalised pattern.
  [/[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!<)[A-Za-z0-9._-]+/gi, 'absolute user path'],
  [/\/(?:home|Users)\/(?!<)[A-Za-z][A-Za-z0-9._-]{2,}/gi, 'absolute home path'],
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
  // A password that is a *reference* to a secret, or an obvious stand-in, is the correct way to
  // write an example — flagging it would push authors towards vaguer, less useful examples.
  /(?:Password|Pwd)\s*=\s*(?:\$env:|\$\{|%[A-Za-z_]+%|\$\()/i,
  /(?:Password|Pwd)\s*=\s*(?:changeme|change-me|placeholder|your[-_]?password|secret|xxx+|\*+)\b/i,
];
// A file whose job is to detect credentials has to carry specimens of them. Only these two, and
// only because the specimens are the test surface — never widen this to a directory.
const LEAK_EXEMPT = new Set(['hooks/secret-scan.js', 'tools/secret-scan.test.mjs']);
for (const rel of textFiles) {
  if (LEAK_EXEMPT.has(rel)) continue;
  const text = read(rel);
  for (const [pattern, label] of LEAKS) {
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
  for (const m of text.matchAll(REFERENCE)) {
    if (!has(m[1])) {
      const line = text.slice(0, m.index).split('\n').length;
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

// ── 4b. Every skill and command has triggering cases ─────────────────────────
// Descriptions are the only thing that decides whether a skill fires, so an untested one is an
// untested trigger. A warning, not an error: adding the asset should not be blocked by it.
if (has('evals/skill-triggering.md')) {
  const evals = read('evals/skill-triggering.md');
  const named = [
    ...allFiles.filter((f) => f.endsWith('/SKILL.md')).map((f) => f.split('/')[1]),
    ...allFiles.filter((f) => f.startsWith('commands/')).map((f) => basename(f, '.md')),
  ];
  // Look for a heading that names the asset, not a mention anywhere in the file: `/commit` appearing
  // inside another skill's case row used to count as coverage for the commit command.
  for (const name of new Set(named)) {
    if (!new RegExp(`^#{2,4} .*\\b${name}\\b`, 'm').test(evals)) {
      warn('evals/skill-triggering.md', `no triggering case section covers '${name}'`);
    }
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
const PRE_V2_SKILLS = new Set(['grill-me']);
const isPreV2 = (rel) => rel.startsWith('skills/') && PRE_V2_SKILLS.has(rel.split('/')[1]);
// wc -l semantics: a trailing newline is a terminator, not an empty final line.
const lineCount = (rel) => read(rel).replace(/\n$/, '').split('\n').length;

const LINE_CAPS = [
  [(f) => f.endsWith('/SKILL.md'), 150, 'SKILL.md'],
  [(f) => /^skills\/[\w-]+\/references\/[\w.-]+\.md$/.test(f), 200, 'reference file'],
  [(f) => f.startsWith('commands/') && f.endsWith('.md'), 100, 'command'],
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
for (const rel of allFiles.filter((f) => f.endsWith('.md') && (f.startsWith('skills/') || f.startsWith('commands/')))) {
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

// A command acts. What it must never do is the part that keeps it safe to run without reading it
// first, so every command declares its limits — as a `## Guardrails` section (the house style) or,
// for a short command, a single `**Never**` line.
for (const rel of allFiles.filter((f) => f.startsWith('commands/') && f.endsWith('.md'))) {
  if (!/(?:^|\n)\s*(?:#{2,4}\s+Guardrails\b|\*\*Never\*\*|Never:|#{2,4}\s+Never\b)/i.test(read(rel))) {
    fail(rel, 'declares no limits — add a `## Guardrails` section or a `**Never**` line');
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const label = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
