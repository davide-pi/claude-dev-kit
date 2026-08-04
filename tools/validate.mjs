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
      fields[currentKey] = m[2].trim();
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
      // Scripts are referenced as $env:CLAUDE_HOOKS\name.ps1 — they must exist in hooks/.
      for (const m of line.matchAll(/CLAUDE_HOOKS[\\/]+([\w.-]+\.ps1)/g)) {
        if (!has(`hooks/${m[1]}`)) {
          fail('settings.json', `hook references hooks/${m[1]}, which is not in the repo`);
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
const EXPLICIT_TRIGGER = ['worklog', 'workitem-create', 'pr-review'];
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
  [/[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!<)[A-Za-z0-9._-]+/g, 'absolute user path'],
  [/\/(?:home|Users)\/(?!<)[a-z][a-z0-9._-]{2,}/g, 'absolute home path'],
  // `git@host` in a clone URL is not an address; neither is anything at example.*
  [/(?<!git)(?<![\w.+-])[\w.+-]+@(?!example\.|ssh\.)[\w-]+\.[a-z]{2,}/gi, 'e-mail address'],
  [/\b(?:glsa_|ghp_|github_pat_|gho_|xoxb-|xoxp-|sk-[A-Za-z0-9]{16})[A-Za-z0-9_-]{8,}/g, 'token-shaped string'],
  [/\b(?:Password|Pwd)\s*=\s*(?!<)[^;'"\s]{3,}/gi, 'password in a connection string'],
];
// Allowed: the MIT line, and documented Windows system paths.
const LEAK_ALLOW = [
  /Davide Piccinini/,                                   // the LICENSE holder, on purpose
  /C:\\Program Files\\PowerShell/,                      // documented system path
  /%USERPROFILE%\\\.local\\bin/,                        // documented in the README
  /C:\\Users\\<[^>]+>/,                                 // explicit placeholder
];
for (const rel of textFiles) {
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

// Agents named in prose must exist (a review flow that spawns a missing agent silently degrades).
for (const rel of textFiles.filter((f) => f.endsWith('.md'))) {
  const text = read(rel);
  for (const m of text.matchAll(/\bspawn(?:ing|s)?\s+(?:the\s+)?\*{0,2}`([\w-]+)`/gi)) {
    if (!agentNames.has(m[1]) && !has(`commands/${m[1]}.md`) && !has(`skills/${m[1]}/SKILL.md`)) {
      const line = text.slice(0, m.index).split('\n').length;
      warn(`${rel}:${line}`, `mentions spawning '${m[1]}', which is not an agent/command/skill in this repo`);
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
