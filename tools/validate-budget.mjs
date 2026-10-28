/**
 * tools/validate.mjs rules: what the kit costs in context, reported and warned, never failed (section 8).
 * Called once by validate.mjs with the shared context; returns the figures the report prints.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function checkBudget({ ROOT, warn, read, has, allFiles, frontMatter }) {
  // ── 8a. Skill bodies ───────────────────────────────────────────────────────
  // A body loads every time its skill fires, so its size is paid per invocation. Listed skills can
  // fire on any turn; paths-gated and user-invoked ones only when a file or a slash command opens them.
  const bodies = { listed: [], hidden: [] };
  for (const rel of allFiles.filter((f) => /^skills\/[\w-]+\/SKILL\.md$/.test(f))) {
    const fm = frontMatter(rel) ?? {};
    const text = read(rel).replace(/\r\n/g, '\n');
    const body = text.startsWith('---') ? text.slice(text.indexOf('\n---', 3) + 4) : text;
    const words = body.split(/\s+/).filter(Boolean).length;
    const hidden = fm['disable-model-invocation'] === 'true' || Boolean(fm.paths);
    bodies[hidden ? 'hidden' : 'listed'].push([rel.split('/')[1], words]);
  }
  const sum = (list) => list.reduce((n, [, w]) => n + w, 0);
  const largest = [...bodies.listed, ...bodies.hidden].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, w]) => `${name} ${w}`).join(', ');
  const bodyLine = `skill bodies: listed ${sum(bodies.listed)} words (${bodies.listed.length} skills), ` +
    `hidden ${sum(bodies.hidden)} words (${bodies.hidden.length} skills); largest: ${largest}`;

  // ── 8b. SessionStart injection ─────────────────────────────────────────────
  // What a SessionStart hook prints as additionalContext is paid in every session before the first
  // prompt. Each hook settings.json registers runs once against this repository with an empty config
  // and home directory, so the figure is the text a fresh session in this repo gets: a floor, not the
  // worst case (pending hours or a findings log add lines on a real machine).
  const SESSION_START_CAP = 1500;
  let sessionLine = null;
  const settings = has('settings.json') ? JSON.parse(read('settings.json')) : {};
  const files = (settings.hooks?.SessionStart ?? []).flatMap((group) => group.hooks ?? [])
    .map((h) => [h.command, ...(h.args ?? [])].join(' ').match(/\/([\w.-]+\.js)\b/)?.[1])
    .filter((file) => file && has(`hooks/${file}`));
  if (files.length) {
    const home = mkdtempSync(join(tmpdir(), 'validate-home-'));
    try {
      const sizes = files.map((file) => {
        const r = spawnSync(process.execPath, [join(ROOT, 'hooks', file)], {
          cwd: ROOT,
          input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'validate', cwd: ROOT }),
          env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: home, CLAUDE_HOOKS: join(ROOT, 'hooks'), CLAUDE_WORKSPACE_ROOTS: '' },
          encoding: 'utf8',
          timeout: 15000,
        });
        let context = '';
        try { context = JSON.parse(r.stdout || '{}').hookSpecificOutput?.additionalContext ?? ''; } catch { /* no JSON: nothing injected */ }
        return [file, Buffer.byteLength(context, 'utf8')];
      });
      const total = sizes.reduce((n, [, b]) => n + b, 0);
      const detail = sizes.map(([file, b]) => `${file} ${b}`).join(', ');
      sessionLine = `session start: ${total} bytes injected (${detail}; this repo, empty config)`;
      if (total > SESSION_START_CAP) {
        warn('settings.json', `SessionStart hooks inject ${total} bytes (${detail}), over the ${SESSION_START_CAP}-byte cap — every session pays it before the first prompt`);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  // ── 8c. Duplicated passages ────────────────────────────────────────────────
  // One asset owns a rule, the others route to it in one line (skill-forge § 1). A run of 12+ words
  // shared by two assets is a copy that will drift, and a cost paid twice when both load. The copies
  // validate-content.mjs keeps byte-identical on purpose are exempt.
  const SHINGLE = 12;
  const owners = [
    (f) => /^skills\/[\w-]+\/SKILL\.md$/.test(f),
    (f) => /^skills\/[\w-]+\/references\/.+\.md$/.test(f),
    (f) => /^rules\/[\w.-]+\.md$/.test(f),
    (f) => /^agents\/[\w.-]+\.md$/.test(f),
    (f) => f === 'CLAUDE.md',
    (f) => /^output-styles\/[\w.-]+\.md$/.test(f),
  ];
  const assets = owners.flatMap((matches) => allFiles.filter(matches));
  const tokens = (text) => {
    const out = [];
    text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
      for (const w of line.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) out.push([w, i + 1]);
    });
    return out;
  };
  // Each canonical copy is blanked out wherever it appears (lines kept), so neither it nor a passage
  // straddling its edge counts.
  const canonical = [];
  const FORMAT = 'skills/code-review/references/report-format.md';
  if (has(FORMAT)) {
    const format = read(FORMAT).replace(/\r\n/g, '\n');
    for (const re of [/## Finding block[\s\S]*?```text\n([\s\S]*?)\n```/, /(\*\*One defect per block[^\n]*(?:\n[^\n]+)*)/,
      /## Order and tables[\s\S]*?```text\n([\s\S]*?)\n```/]) {
      const text = format.match(re)?.[1];
      if (text) canonical.push(text);
    }
  }
  // A command fence (powershell, sql, json…) is a runnable snippet, repeated on purpose where it is
  // used; prose, text and markdown fences are rules and templates, and count.
  const blank = (t) => t.replace(/[^\n]/g, ' ');
  const blanked = (rel) => canonical.reduce((text, c) => text.split(c).join(blank(c)), read(rel).replace(/\r\n/g, '\n'))
    .replace(/^```(?!text|markdown|md)\w[^\n]*\n[\s\S]*?^```[ \t]*$/gm, blank);
  const first = new Map();          // shingle → [file, line]
  for (const rel of assets) {
    const words = tokens(blanked(rel));
    const runs = new Map();         // other file → [{ start, end, line, otherLine }]
    for (let i = 0; i + SHINGLE <= words.length; i++) {
      const key = words.slice(i, i + SHINGLE).map(([w]) => w).join(' ');
      const seen = first.get(key);
      if (!seen) { first.set(key, [rel, words[i][1]]); continue; }
      if (seen[0] === rel) continue;
      const list = runs.get(seen[0]) ?? [];
      const last = list[list.length - 1];
      if (last && last.end === i - 1) last.end = i;
      else list.push({ start: i, end: i, line: words[i][1], otherLine: seen[1] });
      runs.set(seen[0], list);
    }
    for (const [other, list] of runs) {
      const top = list.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
      const length = top.end - top.start + SHINGLE;
      const quote = words.slice(top.start, top.start + 6).map(([w]) => w).join(' ');
      const more = list.length > 1 ? ` (+${list.length - 1} more)` : '';
      warn(`${rel}:${top.line}`, `shares a ${length}-word passage with ${other}:${top.otherLine} "${quote}…"${more} — keep one owner, route to it`);
    }
  }

  return { bodyLine, sessionLine };
}
