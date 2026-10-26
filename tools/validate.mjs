#!/usr/bin/env node
/**
 * Validates the kit without installing it. Zero dependencies — plain Node 18+.
 *
 *   node tools/validate.mjs
 *
 * Exits 1 on any ERROR, 0 when only WARNs remain. Every check exists because something
 * actually broke this way: an asset referenced from settings.json but never committed, a
 * machine-specific path in a public repo, a plugin enabled but undocumented.
 *
 * This file walks the tree and reports; the rules live in validate-assets.mjs, validate-content.mjs
 * and validate-contract.mjs, called in that order with one shared context.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAssets } from './validate-assets.mjs';
import { checkContent } from './validate-content.mjs';
import { checkContract } from './validate-contract.mjs';

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

// ── the rules, in order: a later one reads what an earlier one found ─────────────
const ctx = { ROOT, fail, warn, read, has, allFiles, textFiles, frontMatter };
Object.assign(ctx, checkAssets(ctx));
Object.assign(ctx, checkContent(ctx));
Object.assign(ctx, checkContract(ctx));
const { descriptionBudget, hiddenDescriptions, DESCRIPTION_BUDGET_CHARS, hiddenTotal, descriptionTotal } = ctx;

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
