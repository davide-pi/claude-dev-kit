#!/usr/bin/env node
/**
 * Builds the target repo of one `deliver` bench task: the OrdersApi baseline with the task's bug seeded,
 * committed as a single commit (the git history must not hint at the bug). The hidden xUnit project stays in
 * hidden/ until scoring (installHidden). Run:
 *
 *   node evals/deliver/bench/setup.mjs <task-id> <empty-target-dir>
 *   node evals/deliver/bench/setup.mjs --list
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const HIDDEN_PROJECT = 'OrdersApi.HiddenTests';

export function listTasks() {
  const dir = join(HERE, 'tasks');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

export function loadTask(id) {
  const task = listTasks().find((t) => t.id === id);
  if (!task) throw new Error(`no task ${id} (have: ${listTasks().map((t) => t.id).join(', ')})`);
  return task;
}

export function applySeed(text, { find, replace }) {
  const parts = text.split(find);
  if (parts.length !== 2) throw new Error(`seed anchor must match exactly once (matched ${parts.length - 1}): ${find}`);
  return parts.join(replace);
}

export function buildTarget(taskId, target) {
  const task = loadTask(taskId);
  const dir = resolve(target);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty`);
  mkdirSync(dir, { recursive: true });
  cpSync(join(HERE, 'baseline'), dir, { recursive: true });
  for (const seed of task.seeds) {
    const file = join(dir, seed.file);
    writeFileSync(file, applySeed(readFileSync(file, 'utf8'), seed));
  }
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'core.autocrlf=false', '-c', 'user.name=fixture',
    '-c', 'user.email=fixture@example.invalid', ...a], { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'Orders API');
  return { dir, task };
}

export function installHidden(taskId, dir) {
  const dest = join(dir, HIDDEN_PROJECT);
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(HERE, 'hidden', 'common'), dest, { recursive: true });
  cpSync(join(HERE, 'hidden', taskId), dest, { recursive: true });
  return dest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [a, b] = process.argv.slice(2);
  if (a === '--list') for (const t of listTasks()) console.log(`${t.id}\t${t.kind}`);
  else if (!a || !b) { console.error('usage: setup.mjs <task-id> <empty-target-dir> | --list'); process.exit(2); }
  else console.log(`target ready: ${buildTarget(a, b).dir}`);
}
