#!/usr/bin/env node
/**
 * Negative and positive cases for the validator rules in tools/validate-content.mjs, validate-contract.mjs and
 * validate-assets.mjs: each rule is shown firing on a small mutation of `fixtures/validate/base`, and staying
 * quiet on its documented placeholder or exemption. Fixture secrets are fake and built at runtime so this
 * file does not trip the leak rules it exercises.
 * Zero dependencies — `node:test` on Node 18+.
 *
 *   node --test tools/validate-rules.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = join(HERE, 'validate.mjs');
const BASE = join(HERE, 'fixtures', 'validate', 'base');

/** Copies the base kit, applies `edit(write, read)` and returns the validator's exit code and output. */
function run(edit = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'validate-rules-'));
  try {
    cpSync(BASE, root, { recursive: true });
    const write = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
    const read = (rel) => readFileSync(join(root, rel), 'utf8');
    edit(write, read);
    const r = spawnSync(process.execPath, [VALIDATE], { env: { ...process.env, VALIDATE_ROOT: root, GITHUB_ACTIONS: '' }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Writes `text` to a markdown note in the fixture kit and validates it. */
const note = (text) => run((write) => write('notes.md', `${text}\n`));
const SKILL = ['skills', 'demo', 'SKILL.md'].join('/');
const AGENT = ['agents', 'helper.md'].join('/');
const PW = 'Pass' + 'word';
const PWD = 'Pw' + 'd';
const DOLLAR_BRACE = '$' + '{DB_PASS}';

// ── 3. Leaks ─────────────────────────────────────────────────────────────────

test('given a quoted or bare password value, when the validator runs, then it fails, and placeholders and references stay clean', () => {
  // Given
  const bad = [`${PW}=hunter2abc;`, `${PW}="hunter2abc"`, `${PWD}='hunter2abc'`, `Server=db;${PWD}="hunter2abc";`, `${PW}=}Hunter2`, `${PW}='}Hunter2'`];
  const good = [`${PW}=<password>`, `${PW}="<password>"`, `${PW}=***`, `${PW}="***"`, `${PW}=$env:DB_PASS`, `${PWD}='$env:DB_PASS'`,
    `${PW}="${DOLLAR_BRACE}"`, `${PW}=changeme`, `${PW}='changeme'`, `${PW}=""`, `grep '${PW}=|${PWD}=|Secret'`,
    `\`Server=h;$\{'${PW}='}${DOLLAR_BRACE};\``];
  for (const text of bad) {
    // When
    const r = note(`Connect with ${text}`);
    // Then
    assert.equal(r.code, 1, `must fail: ${text}\n${r.out}`);
    assert.match(r.out, /password in a connection string/, text);
  }
  for (const text of good) {
    const r = note(`Connect with ${text}`);
    assert.equal(r.code, 0, `must stay clean: ${text}\n${r.out}`);
  }
});

test('given a Windows path whose placeholder follows a real folder, when the validator runs, then it fails, and generic or placeholder-first paths stay clean', () => {
  // Given
  const bad = ['D:/customer/<repo>', 'X:\\realfolder\\<x>', 'D:/acme-corp/clients/<repo>', 'D:/customer/x'];
  const good = ['C:\\workspaces\\<product-root>', 'D:/workspaces/<repo>', 'C:\\Program Files\\PowerShell\\7'];
  for (const text of bad) {
    // When
    const r = note(`Clone into ${text} first.`);
    // Then
    assert.equal(r.code, 1, `must fail: ${text}\n${r.out}`);
    assert.match(r.out, /absolute Windows path/, text);
  }
  for (const text of good) {
    const r = note(`Clone into ${text} first.`);
    assert.equal(r.code, 0, `must stay clean: ${text}\n${r.out}`);
  }
});

test('given a user path, home path or system path, when the validator runs, then real names fail and placeholders stay clean', () => {
  // Given
  const user = ['C:', 'Users', 'jdoe42'].join('\\');
  const home = ['', 'home', 'jdoe42'].join('/');
  // When
  const bad = [note(`See ${user}\\file`), note(`See ${home}/file`)];
  // Then
  assert.equal(bad[0].code, 1, bad[0].out);
  assert.match(bad[0].out, /absolute user path/);
  assert.equal(bad[1].code, 1, bad[1].out);
  assert.match(bad[1].out, /absolute home path/);
  const good = note(`See ${['C:', 'Users', '<me>'].join('\\')}\\file and ${['', 'home', '<me>'].join('/')}/file`);
  assert.equal(good.code, 0, good.out);
});

test('given token, AWS key, API key, e-mail or MCP alias shapes, when the validator runs, then each fails and its placeholder stays clean', () => {
  // Given
  const cases = [
    [`${'gh' + 'p_'}${'a1b2c3d4e5f6'}`, /token-shaped string/],
    [`${'AK' + 'IA'}${'ABCDEFGHIJKLMNOP'}`, /AWS access key id/],
    [`${'sk' + '-'}${'x'.repeat(24)}`, /API-key-shaped string/],
    [`${'dev' + '@'}${'corp'}.com`, /e-mail address/],
    [`${'mcp__azdo' + '-'}acme`, /MCP server alias/],
  ];
  for (const [text, label] of cases) {
    // When
    const r = note(`Use ${text} here.`);
    // Then
    assert.equal(r.code, 1, `${label}: ${r.out}`);
    assert.match(r.out, label);
  }
  const clean = note(`Use ${'mcp__azdo' + '-'}<org-alias> or git${'@'}host:repo or dev${'@'}example.com here.`);
  assert.equal(clean.code, 0, clean.out);
});

test('given an Azure DevOps organization in a URL, when the validator runs, then a real name fails and a placeholder stays clean', () => {
  // Given
  const host = 'dev.azure' + '.com/';
  // When
  const bad = note(`Open https://${host}acme-corp/proj`);
  // Then
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /an Azure DevOps organization name \(acme-corp\)/);
  const good = note(`Open https://${host}<org>/proj and https://${host}contoso/proj`);
  assert.equal(good.code, 0, good.out);
});

// ── 4. Cross-references ──────────────────────────────────────────────────────

test('given a reference to a missing kit file, when the validator runs, then it fails unless the line says retired-ok', () => {
  // Given / When
  const ghost = ['tools', 'ghost.mjs'].join('/');
  const bad = note(`See ${ghost} for details.`);
  // Then
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /notes\.md:1: references tools\/ghost\.mjs, which does not exist/);
  const ok = note(`See ${ghost} (retired-ok).`);
  assert.equal(ok.code, 0, ok.out);
  const exists = note('See hooks/guard.js for details.');
  assert.equal(exists.code, 0, exists.out);
});

test('given a markdown link to a local file, when the validator runs, then a missing target fails, an existing one stays clean and ../ only warns', () => {
  // Given / When
  const bad = note('See [gone](gone.md).');
  // Then
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /notes\.md:1: broken link to gone\.md/);
  const good = note('See [readme](README.md) and [site](https://example.com/x.md) and [t](<link>).');
  assert.equal(good.code, 0, good.out);
  const outside = note('See [doc](../docs/x.md).');
  assert.equal(outside.code, 0, outside.out);
  assert.match(outside.out, /resolves outside the repo/);
});

test('given an agent no asset names, when the validator runs, then it warns and a named agent does not', () => {
  // Given / When
  const lonely = run((write, read) => write(['agents', 'lonely.md'].join('/'), read(AGENT).replace('name: helper', 'name: lonely').replace('# helper', '# lonely')));
  // Then
  assert.equal(lonely.code, 0, lonely.out);
  assert.match(lonely.out, /agents\/lonely\.md.*no command, skill or doc ever names this agent/);
  assert.doesNotMatch(run().out, /nothing can reach it/);
});

test('given a finding-format skill whose Finding block differs from report-format, when the validator runs, then it fails and a byte copy does not', () => {
  // Given
  const skill = (block) => `---\nname: finding-format\ndescription: Use when a fixture needs the finding format.\nuser-invocable: false\n---\n\n# finding-format\n\n**Contract.** A format · never edits · English.\n\n## When\n\n- Reviewing.\n\nNot for: real work.\n\n## Decide\n\n| Need | Move |\n| --- | --- |\n| any | copy |\n\n## Do\n\n## Finding block\n\n\`\`\`text\n${block}\n\`\`\`\n\n**One defect per block: split.**\n\n## Traps\n\n1. None.\n`;
  // When
  const drift = run((write) => write('skills/finding-format/SKILL.md', skill('title: y')));
  // Then
  assert.equal(drift.code, 1, drift.out);
  assert.match(drift.out, /skills\/finding-format\/SKILL\.md: inline Finding block differs from the one in skills\/code-review\/references\/report-format\.md/);
  const same = run((write) => write('skills/finding-format/SKILL.md', skill('title: x')));
  assert.doesNotMatch(same.out, /inline Finding block differs/, same.out);
});

test('given a reviewer agent without the finding-format skill, when the validator runs, then it fails', () => {
  // Given / When
  const r = run((write, read) => write('agents/code-reviewer.md', read(AGENT).replace('name: helper', 'name: code-reviewer').replace('# helper', '# code-reviewer')));
  // Then
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /agents\/code-reviewer\.md: skills: must preload finding-format/);
});

// ── 4b. Triggering cases ─────────────────────────────────────────────────────

test('given an evals file with no section for a skill, when the validator runs, then it warns for that skill only', () => {
  // Given / When
  const r = run((write) => write('evals/skill-triggering.md', '# Triggering\n\n## demo\n\n- case\n'));
  // Then
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no triggering case section or evals\/code-review\/ suite covers 'code-review'/);
  assert.doesNotMatch(r.out, /covers 'demo'/);
});

// ── 5. Environment variables ─────────────────────────────────────────────────

test('given a script using an undocumented environment variable, when the validator runs, then it fails and a documented or system one does not', () => {
  // Given
  const script = (name) => (write) => write('scripts/run.ps1', `Write-Output $env:${name}\n`);
  // When
  const bad = run(script('ACME_TOKEN_DIR'));
  // Then
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /README\.md: environment variable ACME_TOKEN_DIR is used by the kit but not documented/);
  const documented = run((write, read) => { script('ACME_TOKEN_DIR')(write); write('README.md', `${read('README.md')}\nACME_TOKEN_DIR points at the cache.\n`); });
  assert.equal(documented.code, 0, documented.out);
  assert.equal(run(script('USERPROFILE')).code, 0);
});

// ── 6. Asset contract ────────────────────────────────────────────────────────

test('given a SKILL.md missing a section, its contract line or its exclusions, when the validator runs, then it fails or warns accordingly', () => {
  // Given
  const edit = (from, to) => run((write, read) => write(SKILL, read(SKILL).replace(from, to)));
  // When
  const noTraps = edit('## Traps', '## Pitfalls');
  // Then
  assert.equal(noTraps.code, 1, noTraps.out);
  assert.match(noTraps.out, /skills\/demo\/SKILL\.md: has no '## Traps' section/);
  const noContract = edit(/\*\*Contract\.\*\*.*\n/, '');
  assert.equal(noContract.code, 1, noContract.out);
  assert.match(noContract.out, /has no `\*\*Contract\.\*\*` line/);
  const shortContract = edit('A result · never writes · English.', 'A result · English.');
  assert.equal(shortContract.code, 1, shortContract.out);
  assert.match(shortContract.out, /the contract line is not `produces · never does · language`/);
  const noExclusion = edit('Not for: real work.', 'Nothing else.');
  assert.equal(noExclusion.code, 0, noExclusion.out);
  assert.match(noExclusion.out, /the 'When' section states no 'Not for:' exclusions/);
});

test('given a skill description, when the validator runs, then it must open with Use when and stay within 35 words', () => {
  // Given
  const describe = (text) => run((write, read) => write(SKILL, read(SKILL).replace(/description: .*/, `description: ${text}`)));
  // When
  const summary = describe('A skill that does a thing.');
  // Then
  assert.equal(summary.code, 1, summary.out);
  assert.match(summary.out, /description must open with `Use when`/);
  const long = describe(`Use when ${'word '.repeat(36).trim()}`);
  assert.equal(long.code, 1, long.out);
  assert.match(long.out, /description is 38 words; keep it to 35/);
  const fine = describe(`Use when ${'word '.repeat(33).trim()}`);
  assert.equal(fine.code, 0, fine.out);
});

test('given a version number in a skill, when the validator runs, then it fails unless the line carries version-ok', () => {
  // Given
  const withLine = (line) => run((write, read) => write(SKILL, `${read(SKILL)}\n${line}\n`));
  // When
  const pinned = withLine('Targets Node 18 or later.');
  // Then
  assert.equal(pinned.code, 1, pinned.out);
  assert.match(pinned.out, /a pinned version \(Node 18\)/);
  const semantic = withLine('Release 4.5.6 is out.');
  assert.equal(semantic.code, 1, semantic.out);
  assert.match(semantic.out, /a semantic version \(4\.5\.6\)/);
  const shaped = withLine('Use v2.3 here.');
  assert.match(shaped.out, /a version-shaped token \(v2\.3\)/);
  const exempt = withLine('Release 4.5.6 is out. <!-- version-ok: fixture -->');
  assert.equal(exempt.code, 0, exempt.out);
});

test('given a reference file its SKILL.md never names, when the validator runs, then it fails and a named one does not', () => {
  // Given / When
  const EXTRA = ['skills', 'demo', 'references', 'extra.md'].join('/');
  const orphan = run((write) => write(EXTRA, '# extra\n'));
  // Then
  assert.equal(orphan.code, 1, orphan.out);
  assert.match(orphan.out, /skills\/demo\/references\/extra\.md: skills\/demo\/SKILL\.md never names it/);
  const named = run((write, read) => { write(EXTRA, '# extra\n'); write(SKILL, `${read(SKILL)}\nSee extra.md.\n`); });
  assert.equal(named.code, 0, named.out);
});

test('given an organization name in a URL or a visualstudio.com host, when the validator runs, then it fails', () => {
  // Given / When
  const r = note(`Open https://${'acme-corp'}.visualstudio${'.com'}/proj`);
  // Then
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /an Azure DevOps organization name \(acme-corp\)/);
});

test('given a plugin tool whose plugin is not enabled, when the validator runs, then it fails and an enabled one does not', () => {
  // Given
  const agent = (read) => read(AGENT).replace('mcp__srv__*', 'mcp__plugin_foo_bar__baz');
  // When
  const off = run((write, read) => write(AGENT, agent(read)));
  // Then
  assert.equal(off.code, 1, off.out);
  assert.match(off.out, /declares tool from plugin 'foo', which is not enabled in settings\.json/);
  const enable = (write, read) => {
    write(AGENT, agent(read));
    write('settings.json', JSON.stringify({ ...JSON.parse(read('settings.json')), enabledPlugins: { 'foo@market': true } }));
  };
  const undocumented = run(enable);
  assert.equal(undocumented.code, 1, undocumented.out);
  assert.match(undocumented.out, /README\.md: plugin 'foo' is enabled in settings\.json but has no install step documented/);
  const on = run((write, read) => { enable(write, read); write('README.md', `${read('README.md')}\nRun /plugin install foo first.\n`); });
  assert.equal(on.code, 0, on.out);
});

// ── 7. Saved workflows ───────────────────────────────────────────────────────

test('given a workflow with a non-deterministic call, an import, a late meta or a syntax error, when the validator runs, then it fails', () => {
  // Given
  const META = "export const meta = { name: 'w' }\n";
  const workflow = (body) => run((write) => write('workflows/w.js', body));
  // When
  const clock = workflow(`${META}const t = ${'Date' + '.now()'}\n`);
  // Then
  assert.equal(clock.code, 1, clock.out);
  assert.match(clock.out, /workflows\/w\.js: uses Date\.now, new Date or Math\.random/);
  const imported = workflow(`${META}import x from 'y'\n`);
  assert.equal(imported.code, 1, imported.out);
  assert.match(imported.out, /workflows\/w\.js: has an import/);
  const late = workflow(`const a = 1\n${META}`);
  assert.equal(late.code, 1, late.out);
  assert.match(late.out, /`export const meta = \{` must be the first statement/);
  const broken = workflow(`${META}const = ;\n`);
  assert.equal(broken.code, 1, broken.out);
  assert.match(broken.out, /does not compile as a workflow body/);
  const commented = workflow(`${META}// ${'Date' + '.now()'} would break replay\nlog('x')\n`);
  assert.equal(commented.code, 0, commented.out);
});

test('given a fake drive path in a .test.tsx, .spec.tsx or .test.ts fixture, when the validator runs, then it is a subject under test, and the same path in a non-test .tsx is still flagged', () => {
  // Given
  const fixture = "const p = 'C:/tmp/out.txt'\n";
  for (const rel of ['mods/x/tests/a.test.ts', 'mods/x/tests/a.test.tsx', 'mods/x/tests/a.spec.tsx']) {
    // When
    const r = run((write) => write(rel, fixture));
    // Then
    assert.equal(r.code, 0, `${rel}: ${r.out}`);
  }
  const src = run((write) => write('mods/x/src/a.tsx', fixture));
  assert.equal(src.code, 1, src.out);
  assert.match(src.out, /mods\/x\/src\/a\.tsx:1: absolute Windows path/);
});
