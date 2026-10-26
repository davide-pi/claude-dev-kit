/**
 * tools/validate.mjs rules: the v2 asset contract, relative imports, byte caps, saved workflows (sections 6-7).
 * Called once by validate.mjs with the shared context; returns what later rules and the report read.
 */

import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

export function checkContract({ ROOT, fail, warn, read, has, allFiles, textFiles, AGENT_MODELS, agentNames }) {
  // ── 6. The v2 asset contract ─────────────────────────────────────────────────
  // The contract (skill-forge § 2, reasons in docs/asset-rules.md) sets three rules nothing else can catch: hard line caps
  // (a skill needing more text needs a reference file, not a longer SKILL.md), a fixed body
  // skeleton, and no version numbers in an asset's prose. One skill is exempt: grill-me is fourteen
  // lines of interview instruction, and the skeleton would only pad it. Everything else conforms —
  // keep this list at one entry.
  const PRE_V2_SKILLS = new Set([]);
  const isPreV2 = (rel) => rel.startsWith('skills/') && PRE_V2_SKILLS.has(rel.split('/')[1]);
  // wc -l semantics: a trailing newline is a terminator, not an empty final line.
  const lineCount = (rel) => read(rel).replace(/\n$/, '').split('\n').length;

  const LINE_CAPS = [
    [(f) => f.endsWith('/SKILL.md'), 120, 'SKILL.md'],
    [(f) => /^skills\/[\w-]+\/references\/[\w.-]+\.md$/.test(f), 200, 'reference file'],
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
    // The contract line is what a user-invoked skill has instead of a guardrails section: what it
    // produces · what it never does · the output language, so it is safe to run without reading it.
    const contract = text.match(/^\*\*Contract\.\*\*.*(?:\n.+)*/m)?.[0];
    if (!contract) fail(rel, 'has no `**Contract.**` line after the title');
    else if (contract.split('·').length < 3) fail(rel, 'the contract line is not `produces · never does · language`');
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
  for (const rel of allFiles.filter((f) => f.endsWith('.md') && f.startsWith('skills/'))) {
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

  // An Azure DevOps organization or project name identifies a client, and this repository is public,
  // so every URL and every explicit --org value must carry a placeholder instead. Checked apart from
  // the leak rules because the shape is specific: a host segment that is not a placeholder.
  const ORG_PATTERNS = [
    [/dev\.azure\.com\/(?![<{%]|your-)([A-Za-z0-9._-]{2,})/g, 'an Azure DevOps organization name'],
    [/\b(?![<{])([A-Za-z][A-Za-z0-9-]{1,})\.visualstudio\.com/g, 'an Azure DevOps organization name'],
  ];
  // Words that are stand-ins rather than customers: a comment documenting the URL shape writes `org`
  // without angle brackets, and Microsoft's own examples use contoso and fabrikam.
  const PLACEHOLDER_ORGS = new Set([
    'org', 'orgname', 'organization', 'myorg', 'yourorg', 'example', 'placeholder',
    'contoso', 'fabrikam', 'tenant',
  ]);
  for (const rel of textFiles) {
    const text = read(rel);
    for (const [pattern, label] of ORG_PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        if (PLACEHOLDER_ORGS.has(m[1].toLowerCase())) continue;
        const line = text.slice(0, m.index).split('\n').length;
        fail(`${rel}:${line}`, `${label} (${m[1]}) — use a placeholder such as <org>`);
      }
    }
  }

  // ── 6b. Relative requires and imports resolve ───────────────────────────────
  // A hook that requires a file nobody committed fails at its first run, on a machine that never saw the repo.
  // Test files are left out: they carry such specimens as strings.
  const RELATIVE_REF = /(?:\brequire\(\s*|\bimport\(\s*|\bfrom\s+|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;
  for (const rel of allFiles.filter((f) => /^(?:hooks\/(?:lib\/)?[\w.-]+\.(?:js|cjs|mjs)|tools\/(?![\w.-]*\.test\.mjs)[\w.-]+\.mjs)$/.test(f))) {
    const text = read(rel);
    for (const m of text.matchAll(RELATIVE_REF)) {
      const base = join(dirname(rel), m[1]).replace(/\\/g, '/');
      const ok = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.json`, `${base}/index.js`].some((c) => {
        const abs = join(ROOT, c);
        return existsSync(abs) && statSync(abs).isFile();
      });
      if (!ok) fail(`${rel}:${text.slice(0, m.index).split('\n').length}`, `requires ${m[1]}, which does not resolve`);
    }
  }

  // ── 6c. Byte caps: what is injected every session or invocation ─────────────
  // CLAUDE.md and the output style load every turn; a SKILL.md re-injects on invocation, cut from the bottom.
  // BYTE_CAP_WARN_ONLY lists files over a cap whose trim another change owns: they warn until trimmed.
  const BYTE_CAPS = [
    [(f) => f === 'CLAUDE.md', 2750, 'CLAUDE.md'],
    [(f) => /^output-styles\/[\w.-]+\.md$/.test(f), 2500, 'an output style'],
    [(f) => /^skills\/[\w-]+\/SKILL\.md$/.test(f), 7000, 'SKILL.md'],
  ];
  const BYTE_CAP_WARN_ONLY = new Set(['CLAUDE.md', 'skills/deliver/SKILL.md']);
  for (const rel of allFiles) {
    for (const [matches, cap, kind] of BYTE_CAPS) {
      if (!matches(rel)) continue;
      const bytes = statSync(join(ROOT, rel)).size;
      if (bytes <= cap) continue;
      const msg = `${bytes} bytes against the ${cap}-byte cap for ${kind}`;
      if (BYTE_CAP_WARN_ONLY.has(rel)) warn(rel, `${msg} — scheduled for the trim`);
      else fail(rel, `${msg}. Move depth into references/ or cut restatements`);
    }
  }

  // ── 7. Saved workflows ───────────────────────────────────────────────────────
  // The runtime strips `export` and runs the file as the body of an async function whose parameters are
  // the orchestration primitives. So `meta` must be the first statement, the body must compile there,
  // and nothing may be non-deterministic or imported: a workflow is replayed, and `Date.now()` or an
  // `import` would break the replay or the compile, silently, at the first `/<name>`.
  const AsyncFunction = (async () => {}).constructor;
  const BUILTIN_AGENTS = ['Explore', 'Plan', 'general-purpose'];
  const WORKFLOW_PARAMS = ['args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow'];
  for (const rel of allFiles.filter((f) => /^workflows\/[\w.-]+\.js$/.test(f))) {
    const src = read(rel);
    if (!/^export const meta = \{/.test(src)) { fail(rel, '`export const meta = {` must be the first statement'); continue; }
    const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    if (/\bDate\.now\s*\(|\bnew Date\s*\(|\bMath\.random\s*\(/.test(code)) fail(rel, 'uses Date.now, new Date or Math.random — a workflow must be deterministic');
    if (/^\s*import\s/m.test(code)) fail(rel, 'has an import — the body runs inside a function, where imports do not exist');
    for (const m of code.matchAll(/\bagentType:\s*'([^']+)'/g)) {
      if (!agentNames.has(m[1]) && !BUILTIN_AGENTS.includes(m[1])) fail(rel, `agentType '${m[1]}' is neither agents/${m[1]}.md nor a built-in agent`);
    }
    for (const m of code.matchAll(/\bmodel:\s*'([^']+)'/g)) {
      if (!AGENT_MODELS.includes(m[1])) fail(rel, `model '${m[1]}' is not one of ${AGENT_MODELS.join(', ')}`);
    }
    try {
      new AsyncFunction(...WORKFLOW_PARAMS, src.replace(/^export /, ''));
    } catch (e) {
      fail(rel, `does not compile as a workflow body — ${e.message}`);
    }
  }
}
