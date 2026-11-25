#!/usr/bin/env node
/**
 * kit-close: the one command that closes a kit change. Run it from PowerShell (the install
 * copies must persist). Fail-fast, every command through spawnSync argv, never a shell, never a push:
 *
 *   commit  ->  install  ->  verify  ->  plugin (only for mods/cockpit/ changes)
 *
 *   node tools/kit-close.mjs --head <start sha> --message "<commit msg>" --paths a,b
 *        [--root <repo>] [--base <ref>] [--home <claude home>] [--dry-run]
 *
 *   --head      the run's start head: also the default --base the installed copies are checked against
 *   --paths     the files this change owns: the only ones staged and committed (the rest of the tree stays as it is)
 *   --dry-run   print the plan, run nothing
 *
 * install.ps1 is the repo's own. Exit 0 all green, 1 at the first red step (named on the last line), 2 a usage error.
 */

import { spawnSync } from 'node:child_process';
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

export async function closeChange(opts, run = spawnRunner) {
  const { root, head, message, home } = opts;
  const base = opts.base ?? head;
  const owned = new Set((opts.paths ?? []).map(p => norm(p).replace(/^(\.\/)+/, '').replace(/\/+$/, '')).filter(Boolean));
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

  if (!owned.size) return { code: 2, failed: null, steps, lines: ['kit-close: --paths is required: the files this change owns, comma separated'] };

  if (opts.dryRun) {
    const plan = [
      `git add -- <the --paths files that changed>; git commit -m "${message}" -- <same paths>`,
      `pwsh ${pwsh(installPs1, '-ClaudeHome', home, '-Only', '<git diff --name-only ' + base + '..HEAD>', '-Base', base).join(' ')}`,
      `pwsh ${pwsh(installPs1, '-ClaudeHome', home, '-Verify', '-Only', '<same files>').join(' ')}`,
      `claude plugin test ${join(home, 'mods', 'cockpit')}  (only when a changed path starts with mods/cockpit/)`,
    ];
    return { code: 0, failed: null, steps, lines: plan.map(p => `dry-run: ${p}`) };
  }

  // 1. commit: only the --paths files, so every other dirty file stays out. Never -A, never a push.
  steps.push('commit');
  const st = run('git', ['-c', 'core.quotepath=off', '-C', root, 'status', '--porcelain', '-uall'], { cwd: root });
  if (st.status !== 0) return stop('commit', reason(st));
  const dirty = [...new Set(porcelainPaths(st.stdout))];
  // An entry is a file or a directory prefix; one that matches nothing is a typo or a stale path: fail, never a partial commit.
  const matches = p => dirty.filter(f => f === p || f.startsWith(`${p}/`));
  let unmatched = [...owned].filter(p => !matches(p).length);
  if (unmatched.length) {
    // A rerun after the commit landed: an entry no longer dirty but already in base..HEAD counts as committed.
    const done = run('git', ['-c', 'core.quotepath=off', '-C', root, 'diff', '--name-only', `${base}..HEAD`], { cwd: root });
    if (done.status !== 0) return stop('commit', reason(done));
    const committed = tail(done.stdout).map(norm);
    unmatched = unmatched.filter(p => !committed.some(f => f === p || f.startsWith(`${p}/`)));
  }
  if (unmatched.length) return stop('commit', `--paths matched nothing in git status: ${unmatched.join(', ')}`);
  const paths = dirty.filter(f => [...owned].some(p => f === p || f.startsWith(`${p}/`)));
  if (paths.length) {
    const add = run('git', ['-C', root, 'add', '--', ...paths], { cwd: root });
    if (add.status !== 0) return stop('commit', reason(add));
    const commit = run('git', ['-C', root, 'commit', '-m', message, '--', ...paths], { cwd: root });
    if (commit.status !== 0) return stop('commit', reason(commit));
  }
  const sha = run('git', ['-C', root, 'rev-parse', 'HEAD'], { cwd: root });
  say('commit', paths.length ? lastLine(sha.stdout) : `nothing to commit (HEAD ${lastLine(sha.stdout)})`);

  // 2. install the changed assets, then 3. verify in a separate process.
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
  // Repo-only changes (tools/, README, CI) hold no asset: the installer says so with exit 1, which is not a failure here.
  if (inst.status === 1 && /nothing verified/i.test(inst.stdout)) {
    say('install', 'nothing to install: no kit asset changed');
    return { code: 0, failed: null, steps, lines };
  }
  if (inst.status !== 0) return stop('install', reason(inst));
  steps.push('verify');
  const ver = run('pwsh', pwsh(installPs1, '-ClaudeHome', home, '-Verify', '-Only', only), { cwd: root });
  for (const l of tail(ver.stdout)) say('verify', l);
  if (ver.status !== 0) return stop('verify', reason(ver));
  if (/nothing verified/i.test(ver.stdout)) return stop('verify', 'checked zero assets');
  say('verify', 'repo == home for the changed assets');

  // 4. the cockpit mod's own tests, on the installed copy.
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
  const flags = { '--root': 'root', '--head': 'head', '--base': 'base', '--message': 'message', '--paths': 'paths', '--home': 'home' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') o.dryRun = true;
    else if (flags[argv[i]] && i + 1 < argv.length) o[flags[argv[i]]] = argv[++i];
    else return { error: `unknown or incomplete argument ${argv[i]}` };
  }
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const a = parseArgs(process.argv.slice(2));
  const missing = a.error ? [a.error] : ['head', 'message', 'paths'].filter(k => !a[k]).map(k => `--${k} is required`);
  if (missing.length) {
    console.error(`kit-close: ${missing.join('; ')}`);
    process.exit(2);
  }
  const opts = { ...a, root: resolve(a.root ?? process.cwd()), home: resolve(a.home ?? join(homedir(), '.claude')), paths: a.paths ? a.paths.split(',').map(s => s.trim()).filter(Boolean) : [] };
  const result = await closeChange(opts);
  for (const l of result.lines) console.log(l);
  process.exit(result.code);
}
