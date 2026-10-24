#!/usr/bin/env node
/**
 * Builds the seeded-bug repo for `/code-review` evals: a baseline commit, then one commit that carries
 * 4 acceptance criteria and 13 planted defects (see answer-key.md). Run:
 *
 *   node evals/code-review/seeded/setup.mjs <empty-target-dir> [--kit] [--kit-md] [--no-user-md]
 *
 *   --kit         copy this kit's 3 review agents and the `code-review` + `pr-review` skills into the target's
 *                 .claude/ (project-level install; kept out of git via .git/info/exclude)
 *   --kit-md      also install the kit's CLAUDE.md and the owner-80-20 style (project-level)
 *   --no-user-md  exclude the user-level ~/.claude/CLAUDE.md for that project, so the main session
 *                 runs under the kit's CLAUDE.md alone (use with --kit-md)
 *
 * Then, inside the target: `claude -p "/code-review" --model opus --effort medium`.
 * The password in ExportService.cs is a planted fake.
 */
import { cpSync, mkdirSync, readdirSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(HERE, '../../..');
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) { console.error('usage: setup.mjs <empty-target-dir> [--kit] [--kit-md] [--no-user-md]'); process.exit(2); }
const dir = resolve(target);
if (existsSync(dir) && readdirSync(dir).length) { console.error(`${dir} is not empty`); process.exit(2); }

const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'core.autocrlf=false', '-c', 'user.name=fixture',
  '-c', 'user.email=fixture@example.invalid', ...a], { stdio: ['ignore', 'pipe', 'inherit'] }).toString();

mkdirSync(dir, { recursive: true });
cpSync(join(HERE, 'baseline'), dir, { recursive: true });
git('init', '-q');
git('add', '-A');
git('commit', '-q', '-m', 'Baseline: orders API with list, get, confirm');
git('apply', join(HERE, 'change.patch'));
git('add', '-A');
git('commit', '-q', '-F', join(HERE, 'commit-message.txt'));

const claude = join(dir, '.claude');
const exclude = [];
if (args.includes('--kit')) {
  for (const a of ['code-reviewer', 'review-security', 'review-performance']) {
    cpSync(join(KIT, 'agents', `${a}.md`), join(claude, 'agents', `${a}.md`));
  }
  for (const s of ['code-review', 'pr-review']) cpSync(join(KIT, 'skills', s), join(claude, 'skills', s), { recursive: true });
  exclude.push('.claude/');
}
const settings = {};
if (args.includes('--kit-md')) {
  cpSync(join(KIT, 'output-styles'), join(claude, 'output-styles'), { recursive: true });
  cpSync(join(KIT, 'CLAUDE.md'), join(dir, 'CLAUDE.md'));
  settings.outputStyle = 'owner-80-20';
  exclude.push('.claude/', 'CLAUDE.md');
}
if (args.includes('--no-user-md')) settings.claudeMdExcludes = [join(homedir(), '.claude', 'CLAUDE.md').replaceAll('\\', '/')];
if (Object.keys(settings).length) {
  mkdirSync(claude, { recursive: true });
  writeFileSync(join(claude, 'settings.local.json'), JSON.stringify(settings, null, 2) + '\n');
  exclude.push('.claude/');
}
if (exclude.length) appendFileSync(join(dir, '.git', 'info', 'exclude'), [...new Set(exclude)].join('\n') + '\n');
console.log(`seeded repo ready: ${dir} (HEAD ${git('rev-parse', '--short', 'HEAD').trim()})`);
