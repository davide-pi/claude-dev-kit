/**
 * tools/validate.mjs rules: leaks, cross-references, triggering cases, environment variables (sections 3-5).
 * Called once by validate.mjs with the shared context; returns what later rules and the report read.
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export function checkContent({ ROOT, fail, warn, read, has, allFiles, textFiles, agentNames }) {
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
  const isTestFile = (rel) => /^(?:tools\/[\w.-]+\.(?:test|harness)\.mjs|mods\/[\w.-]+\/tests\/[\w.-]+\.test\.ts)$/.test(rel);
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
  //   - the report skeleton (fenced) in the code-review skill and the review-large merger.
  {
    const FORMAT = 'skills/code-review/references/report-format.md';
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
      ['skills/code-review/SKILL.md', 'workflows/review-large.js']);
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

  // ── 4c. Table templates the model copies fit a terminal ─────────────────────
  // A ```markdown fence in a skill is a table the model prints as is: past 8 columns it wraps and falls apart
  // in the terminal, and `~` pairs in a row render as strikethrough (the worklog's Table 1, 2026-10-26).
  for (const rel of textFiles.filter((f) => f.startsWith('skills/') && f.endsWith('.md'))) {
    let inTemplate = false;
    read(rel).split(/\r?\n/).forEach((text, i) => {
      if (/^```markdown\b/.test(text)) inTemplate = true;
      else if (/^```/.test(text)) inTemplate = false;
      else if (inTemplate && text.startsWith('|')) {
        const columns = text.split('|').length - 2;
        if (columns > 8) fail(`${rel}:${i + 1}`, `table template has ${columns} columns: at most 8 fit a terminal`);
        if (text.includes('~')) fail(`${rel}:${i + 1}`, 'table template has `~`: two in a row render as strikethrough');
      }
    });
  }

  // ── 4b. No output language is hardcoded: assets name the aspect's language, never "Italian" ──
  // Bans the output-language phrasing, not the bare word (trigger phrases and example data stay).
  const OUTPUT_ITALIAN = new RegExp([
    String.raw`\bin\s+\*{0,2}Italian\b`,
    String.raw`\bItalian\*{0,2}\s+(?:report|prose|chat|comments?|commits?|titles?|bod(?:y|ies)|answers?|text|messages?|headers?|headings?|questions?|line)\b`,
    String.raw`\b(?:report|prose|chat|comments?|commits?|title|body|explanations?|answers?|text)\s+\*{0,2}Italian\b`,
    String.raw`\bItalian\*{0,2}\s+(?:reading|summary|topic|label|name|verdict)\b`,
    String.raw`\b(?:is|are|stays?)\s+\*{0,2}Italian\b`,
    String.raw`[,·—:(<]\s*\*{0,2}Italian\*{0,2}\s*[;,.>)]`,
  ].join('|'), 'g');
  const languageScoped = (f) => f === 'CLAUDE.md' || f === 'loop.md' || /^(?:agents|skills|workflows|output-styles|rules)\/.+\.(?:md|js)$/.test(f);
  for (const rel of textFiles.filter(languageScoped)) {
    const text = read(rel).replace(/\r\n/g, '\n');
    for (const m of text.matchAll(OUTPUT_ITALIAN)) {
      const line = text.slice(0, m.index).split('\n').length;
      fail(`${rel}:${line}`, `names Italian as an output language ("${m[0].replace(/\s+/g, ' ')}"): use the aspect's token ("the chat language", "the commit language", ...)`);
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
}
