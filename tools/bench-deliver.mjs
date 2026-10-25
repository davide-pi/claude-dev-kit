#!/usr/bin/env node
/**
 * `deliver` bench: for each seeded-bug task, builds a fresh target, runs `claude -p` in it, copies the hidden
 * xUnit project in, runs `dotnet test` and records solved / regressions / tokens / cost / minutes.
 *
 *   node tools/bench-deliver.mjs --label <name> [--tasks a,b] [--budget 2] [--timeout-min 30]
 *                                [--claude-bin claude] [--claude-args "<extra CLI args>"] [--keep] [--dry-run]
 *   node tools/bench-deliver.mjs --compare <labelA> <labelB>
 *   node tools/bench-deliver.mjs --list
 *
 * A real run spends money on your credential (capped per task by --max-budget-usd). --dry-run builds the targets
 * and prints the commands, nothing else. Results: evals/deliver/bench/results/<label>.jsonl.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = join(ROOT, 'evals', 'deliver', 'bench');
const RESULTS = join(BENCH, 'results');
export const DEFAULT_CLAUDE_ARGS = ['--permission-mode', 'acceptEdits', '--allowed-tools', 'Bash(dotnet:*)', 'Bash(git:*)'];

// ---- pure logic (unit-tested) ----

export function parseClaudeJson(stdout) {
  let j;
  try { j = JSON.parse(stdout); } catch { return { ok: false, tokens: 0, costUsd: 0, isError: true }; }
  if (Array.isArray(j)) j = j.findLast((x) => x?.type === 'result') ?? {};
  const u = j.usage ?? {};
  const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
    + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return { ok: true, tokens, costUsd: Number(j.total_cost_usd ?? j.cost_usd ?? 0), isError: Boolean(j.is_error), turns: j.num_turns ?? null };
}

export function buildClaudeArgs(prompt, budget, extra = DEFAULT_CLAUDE_ARGS) {
  return ['-p', prompt, '--output-format', 'json', '--max-budget-usd', String(budget), ...extra];
}

export function makeRecord({ label, task, claude, oracleExit, regressionExit, minutes, ts }) {
  return {
    label, task,
    solved: oracleExit === 0,
    regressions: regressionExit !== 0,
    tokens: claude.tokens, costUsd: claude.costUsd,
    minutes: Math.round(minutes * 100) / 100,
    ...(claude.isError ? { claudeError: true } : {}),
    ts: ts ?? new Date().toISOString(),
  };
}

export function summarize(records) {
  const n = records.length;
  const sum = (k) => records.reduce((s, r) => s + (r[k] ?? 0), 0);
  return {
    n, solved: records.filter((r) => r.solved).length, regressions: records.filter((r) => r.regressions).length,
    tokens: sum('tokens'), costUsd: Math.round(sum('costUsd') * 10000) / 10000, minutes: Math.round(sum('minutes') * 100) / 100,
  };
}

export function parseJsonl(text) {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// Last record per task wins, so a re-run of one task replaces its earlier line.
export function latestPerTask(records) {
  const m = new Map();
  for (const r of records) m.set(r.task, r);
  return [...m.values()];
}

const fmtDelta = (a, b, digits = 0) => {
  const d = b - a;
  return `${d > 0 ? '+' : ''}${d.toFixed(digits)}`;
};

export function compareRuns(a, b) {
  const A = new Map(a.map((r) => [r.task, r]));
  const B = new Map(b.map((r) => [r.task, r]));
  const tasks = [...new Set([...A.keys(), ...B.keys()])].sort();
  const status = (r) => (!r ? '-' : r.solved ? (r.regressions ? 'solved+REG' : 'solved') : (r.regressions ? 'unsolved+REG' : 'unsolved'));
  const rows = tasks.map((task) => {
    const x = A.get(task), y = B.get(task);
    return {
      task, before: status(x), after: status(y),
      dTokens: x && y ? y.tokens - x.tokens : null,
      dCostUsd: x && y ? Math.round((y.costUsd - x.costUsd) * 10000) / 10000 : null,
      dMinutes: x && y ? Math.round((y.minutes - x.minutes) * 100) / 100 : null,
    };
  });
  return { rows, before: summarize(a), after: summarize(b) };
}

const pad = (s, w) => String(s).padEnd(w);

export function formatTable(records) {
  const head = ['task', 'solved', 'regress', 'tokens', 'cost$', 'min'];
  const rows = records.map((r) => [r.task, r.solved ? 'yes' : 'NO', r.regressions ? 'YES' : 'no', r.tokens, r.costUsd.toFixed(2), r.minutes.toFixed(1)]);
  const s = summarize(records);
  rows.push(['TOTAL', `${s.solved}/${s.n}`, s.regressions, s.tokens, s.costUsd.toFixed(2), s.minutes.toFixed(1)]);
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  return [head, ...rows].map((r) => r.map((c, i) => pad(c, w[i])).join('  ').trimEnd()).join('\n');
}

export function formatCompare({ rows, before, after }, la = 'before', lb = 'after') {
  const head = ['task', la, lb, 'dTokens', 'dCost$', 'dMin'];
  const body = rows.map((r) => [r.task, r.before, r.after,
    r.dTokens === null ? '-' : fmtDelta(0, r.dTokens), r.dCostUsd === null ? '-' : fmtDelta(0, r.dCostUsd, 2), r.dMinutes === null ? '-' : fmtDelta(0, r.dMinutes, 1)]);
  body.push(['TOTAL', `${before.solved}/${before.n}`, `${after.solved}/${after.n}`,
    fmtDelta(before.tokens, after.tokens), fmtDelta(before.costUsd, after.costUsd, 2), fmtDelta(before.minutes, after.minutes, 1)]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i]).length)));
  return [head, ...body].map((r) => r.map((c, i) => pad(c, w[i])).join('  ').trimEnd()).join('\n');
}

export function parseArgs(argv) {
  const o = { budget: 2, timeoutMin: 30, claudeBin: 'claude', claudeArgs: null, tasks: null, keep: false, dryRun: false, list: false, compare: null, label: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') o.label = argv[++i];
    else if (a === '--tasks') o.tasks = argv[++i].split(',');
    else if (a === '--budget') o.budget = Number(argv[++i]);
    else if (a === '--timeout-min') o.timeoutMin = Number(argv[++i]);
    else if (a === '--claude-bin') o.claudeBin = argv[++i];
    else if (a === '--claude-args') o.claudeArgs = argv[++i].split(/\s+/).filter(Boolean);
    else if (a === '--keep') o.keep = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--list') o.list = true;
    else if (a === '--compare') { o.compare = [argv[++i], argv[++i]]; }
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

// ---- side effects ----

function readResults(label) {
  const f = join(RESULTS, `${label}.jsonl`);
  if (!existsSync(f)) throw new Error(`no results for '${label}' (${f})`);
  return latestPerTask(parseJsonl(readFileSync(f, 'utf8')));
}

const show = (cmd, args) => [cmd, ...args.map((a) => (/[\s"()*]/.test(a) ? JSON.stringify(a) : a))].join(' ');

function dotnetTest(project, filter, cwd) {
  const args = ['test', project, '--filter', `FullyQualifiedName~${filter}`, '--nologo', '-v', 'q'];
  const r = spawnSync('dotnet', args, { cwd, encoding: 'utf8', timeout: 10 * 60_000 });
  return r.status ?? 1;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const setup = await import(pathToFileURL(join(BENCH, 'setup.mjs')).href);
  if (o.list) { for (const t of setup.listTasks()) console.log(`${t.id}\t${t.kind}`); return; }
  if (o.compare) {
    const [la, lb] = o.compare;
    console.log(formatCompare(compareRuns(readResults(la), readResults(lb)), la, lb));
    return;
  }
  if (!o.label) throw new Error('--label is required (or --compare a b, --list)');
  const tasks = o.tasks ? o.tasks.map((id) => setup.loadTask(id)) : setup.listTasks();
  const claudeArgs = o.claudeArgs ?? DEFAULT_CLAUDE_ARGS;
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const out = join(RESULTS, `${o.label}.jsonl`);
  const records = [];
  if (!o.dryRun) mkdirSync(RESULTS, { recursive: true });

  for (const t of tasks) {
    const dir = join(tmpdir(), 'bench-deliver', `${o.label}-${t.id}-${stamp}`);
    rmSync(dir, { recursive: true, force: true });
    setup.buildTarget(t.id, dir);
    const args = buildClaudeArgs(t.prompt, o.budget, claudeArgs);
    const project = join(dir, setup.HIDDEN_PROJECT, `${setup.HIDDEN_PROJECT}.csproj`);
    if (o.dryRun) {
      console.log(`== ${t.id} (${t.kind})  target: ${dir}`);
      console.log(`   cwd ${dir}\n   ${show(o.claudeBin, args)}`);
      console.log(`   then copy hidden/common + hidden/${t.id} into ${setup.HIDDEN_PROJECT}/`);
      console.log(`   ${show('dotnet', ['test', project, '--filter', 'FullyQualifiedName~Oracle'])}\n   ${show('dotnet', ['test', project, '--filter', 'FullyQualifiedName~Regression'])}`);
      if (!o.keep) rmSync(dir, { recursive: true, force: true });
      continue;
    }
    console.error(`== ${t.id}: running claude in ${dir}`);
    const t0 = Date.now();
    const r = spawnSync(o.claudeBin, args, { cwd: dir, encoding: 'utf8', timeout: o.timeoutMin * 60_000, maxBuffer: 256 * 1024 * 1024 });
    const minutes = (Date.now() - t0) / 60_000;
    const claude = parseClaudeJson(r.stdout ?? '');
    if (r.error) console.error(`   claude: ${r.error.message}`);
    setup.installHidden(t.id, dir);
    const oracleExit = dotnetTest(project, 'Oracle', dir);
    const regressionExit = dotnetTest(project, 'Regression', dir);
    const rec = makeRecord({ label: o.label, task: t.id, claude, oracleExit, regressionExit, minutes });
    appendFileSync(out, JSON.stringify(rec) + '\n');
    records.push(rec);
    if (!o.keep) rmSync(dir, { recursive: true, force: true });
  }
  if (o.dryRun) { console.log('\ndry run: no claude run, no results written'); return; }
  console.log('\n' + formatTable(records));
  console.log(`\nresults: ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exit(2); });
}
