#!/usr/bin/env node
/**
 * kit-close: the one command that closes a kit change after the dev-loop is OK. Run it from PowerShell (the install
 * copies must persist). Fail-fast, every command through spawnSync argv, never a shell, never a push:
 *
 *   gate  ->  sweep  ->  perimeter  ->  commit  ->  install  ->  verify  ->  plugin (only for mods/cockpit/ changes)
 *
 *   node tools/kit-close.mjs --head <start sha> --test "<test command>" --findings <json path> --message "<commit msg>"
 *        [--root <repo>] [--base <ref>] [--dirty a,b] [--run <id>] [--home <claude home>] [--dry-run]
 *
 *   --head      the run's start head: also the default --base the installed copies are checked against
 *   --dirty     files already dirty at the start: left out of the commit; only perimeter.md entries are committed
 *   --run       passed to perimeter.ps1 -Run
 *   --dry-run   print the plan, run nothing
 *
 * gate.mjs, sweep.mjs and perimeter.ps1 are the installed ones (<home>/scripts); install.ps1 is the repo's own.
 * Exit 0 all green, 1 at the first red step (named on the last line), 2 a usage error.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const norm = p => String(p).replaceAll('\\', '/');
const tail = text => String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const lastLine = text => tail(text).at(-1) ?? '';

/** The real runner: argv only, no shell. */
export function spawnRunner(cmd, args, { cwd } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return { status: 1, stdout: r.stdout ?? '', stderr: `${r.error.message}\n${r.stderr ?? ''}` };
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Paths of `git status --porcelain` (renames: the new name; quoted names unquoted). */
function porcelainPaths(text) {
  return String(text).split(/\r?\n/).filter(l => l.length > 3).map(l => {
    let p = l.slice(3);
    if (p.includes(' -> ')) p = p.split(' -> ').at(-1);
    return norm(p.replace(/^"(.*)"$/, '$1'));
  });
}

// One perimeter semantics: the scope-guard hook's own parser and matcher.
const { entryRegex, readPerimeter } = createRequire(import.meta.url)('../hooks/scope-guard.js');

export async function closeChange(opts, run = spawnRunner) {
  const { root, head, test, findings, message, home } = opts;
  const base = opts.base ?? head;
  const dirty = new Set((opts.dirty ?? []).map(norm));
  const scripts = join(home, 'scripts');
  const installPs1 = join(root, 'install.ps1');
  const pwsh = (...args) => ['-NoProfile', '-File', ...args];
  const steps = [];
  const lines = [];
  const say = (step, text) => lines.push(`${step}: ${text}`);
  const stop = (step, why) => {
    say(step, `FAILED ${why}`);
    lines.push(`kit-close stopped at ${step}`);
    return { code: 1, failed: step, steps, lines };
  };
  const reason = r => lastLine(r.stderr) || lastLine(r.stdout) || `exit ${r.status}`;

  if (opts.dryRun) {
    const plan = [
      `node ${join(scripts, 'gate.mjs')} --root ${root} --head ${head} --test "${test}"  (exit 3: rerun with --wait)`,
      `node ${join(scripts, 'sweep.mjs')} --root ${root} --since <perimeter opened:> --close`,
      `pwsh ${pwsh(join(scripts, 'perimeter.ps1'), '-Close', '-FindingsLog', findings).join(' ')}`,
      `git add -- <changed files in perimeter.md minus dirty>; git commit -m "${message}" -- <same paths>`,
      `pwsh ${pwsh(installPs1, '-ClaudeHome', home, '-Only', '<git diff --name-only ' + base + '..HEAD>', '-Base', base).join(' ')}`,
      `pwsh ${pwsh(installPs1, '-ClaudeHome', home, '-Verify', '-Only', '<same files>').join(' ')}`,
      `claude plugin test ${join(home, 'mods', 'cockpit')}  (only when a changed path starts with mods/cockpit/)`,
    ];
    return { code: 0, failed: null, steps, lines: plan.map(p => `dry-run: ${p}`) };
  }

  // 1. gate: the last stdout line is JSON; exit 3 means still running, so wait on the same run.
  steps.push('gate');
  let g = run('node', [join(scripts, 'gate.mjs'), '--root', root, '--head', head, '--test', test], { cwd: root });
  if (g.status === 3) g = run('node', [join(scripts, 'gate.mjs'), '--root', root, '--wait'], { cwd: root });
  const gateLine = lastLine(g.stdout);
  let verdict;
  try { verdict = JSON.parse(gateLine).gate; } catch { verdict = undefined; }
  say('gate', gateLine || reason(g));
  if (g.status !== 0 || !['green', 'skipped'].includes(verdict)) return stop('gate', `gate is ${verdict ?? 'unreadable'} (exit ${g.status})`);

  // 2. sweep: closes what the gate started; --since is the perimeter's `opened:`.
  steps.push('sweep');
  const gitDir = run('git', ['-C', root, 'rev-parse', '--git-dir'], { cwd: root });
  let opened;
  let matchers = [];
  try {
    // Read before perimeter -Close, which archives the file.
    const perimeter = readFileSync(join(resolve(root, lastLine(gitDir.stdout)), 'deliver', 'perimeter.md'), 'utf8');
    opened = /^opened:[ \t]*(\S+)/m.exec(perimeter)?.[1];
    matchers = readPerimeter(perimeter).entries.map(entryRegex);
  } catch { /* reported below */ }
  if (!opened) return stop('sweep', 'no perimeter with an opened: line');
  const s = run('node', [join(scripts, 'sweep.mjs'), '--root', root, '--since', opened, '--close'], { cwd: root });
  say('sweep', lastLine(s.stdout) || reason(s));
  if (s.status !== 0) return stop('sweep', reason(s));

  // 3. perimeter: log the findings and close.
  steps.push('perimeter');
  const p = run('pwsh', pwsh(join(scripts, 'perimeter.ps1'), '-Close', '-FindingsLog', findings, ...(opts.run ? ['-Run', String(opts.run)] : [])), { cwd: root });
  say('perimeter', lastLine(p.stdout) || reason(p));
  if (p.status !== 0) return stop('perimeter', reason(p));

  // 4. commit: explicit paths only, so what was dirty at the start stays out. Never -A, never a push.
  steps.push('commit');
  const st = run('git', ['-c', 'core.quotepath=off', '-C', root, 'status', '--porcelain', '-uall'], { cwd: root });
  if (st.status !== 0) return stop('commit', reason(st));
  const candidates = [...new Set(porcelainPaths(st.stdout))].filter(f => !dirty.has(f));
  const paths = candidates.filter(f => matchers.some(re => re.test(f)));
  const outside = candidates.filter(f => !paths.includes(f));
  if (outside.length) say('commit', `not committed (outside perimeter): ${outside.join(', ')}`);
  if (paths.length) {
    const add = run('git', ['-C', root, 'add', '--', ...paths], { cwd: root });
    if (add.status !== 0) return stop('commit', reason(add));
    const commit = run('git', ['-C', root, 'commit', '-m', message, '--', ...paths], { cwd: root });
    if (commit.status !== 0) return stop('commit', reason(commit));
  }
  const sha = run('git', ['-C', root, 'rev-parse', 'HEAD'], { cwd: root });
  say('commit', paths.length ? lastLine(sha.stdout) : `nothing to commit (HEAD ${lastLine(sha.stdout)})`);

  // 5. install the changed assets, then 6. verify in a separate process.
  const diff = run('git', ['-c', 'core.quotepath=off', '-C', root, 'diff', '--name-only', `${base}..HEAD`], { cwd: root });
  if (diff.status !== 0) return stop('install', reason(diff));
  const changed = tail(diff.stdout).map(norm);
  if (!changed.length) {
    say('install', 'nothing to install');
    return { code: 0, failed: null, steps, lines };
  }
  steps.push('install');
  const only = changed.join(',');
  const inst = run('pwsh', pwsh(installPs1, '-ClaudeHome', home, '-Only', only, '-Base', base), { cwd: root });
  for (const l of tail(inst.stdout)) say('install', l);
  if (inst.status !== 0) return stop('install', reason(inst));
  steps.push('verify');
  const ver = run('pwsh', pwsh(installPs1, '-ClaudeHome', home, '-Verify', '-Only', only), { cwd: root });
  for (const l of tail(ver.stdout)) say('verify', l);
  if (ver.status !== 0) return stop('verify', reason(ver));
  say('verify', 'repo == home for the changed assets');

  // 7. the cockpit mod's own tests, on the installed copy.
  if (changed.some(f => f.startsWith('mods/cockpit/'))) {
    steps.push('plugin');
    const pt = run('claude', ['plugin', 'test', join(home, 'mods', 'cockpit')], { cwd: root });
    say('plugin', lastLine(pt.stdout) || reason(pt));
    if (pt.status !== 0) return stop('plugin', reason(pt));
  }
  return { code: 0, failed: null, steps, lines };
}

function parseArgs(argv) {
  const o = {};
  const flags = { '--root': 'root', '--head': 'head', '--base': 'base', '--test': 'test', '--findings': 'findings', '--message': 'message', '--dirty': 'dirty', '--run': 'run', '--home': 'home' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') o.dryRun = true;
    else if (flags[argv[i]] && i + 1 < argv.length) o[flags[argv[i]]] = argv[++i];
    else return { error: `unknown or incomplete argument ${argv[i]}` };
  }
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const a = parseArgs(process.argv.slice(2));
  const missing = a.error ? [a.error] : ['head', 'test', 'findings', 'message'].filter(k => !a[k]).map(k => `--${k} is required`);
  if (missing.length) {
    console.error(`kit-close: ${missing.join('; ')}`);
    process.exit(2);
  }
  const opts = { ...a, root: resolve(a.root ?? process.cwd()), home: resolve(a.home ?? join(homedir(), '.claude')), dirty: a.dirty ? a.dirty.split(',').map(s => s.trim()).filter(Boolean) : [] };
  const result = await closeChange(opts);
  for (const l of result.lines) console.log(l);
  process.exit(result.code);
}
