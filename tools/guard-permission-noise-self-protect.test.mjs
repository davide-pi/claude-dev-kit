// Tests for hooks/lib/self-protect.js through hooks/lib/guard.js: inline cd tracking, the other spellings of the
// ~/.claude root (msys, 8.3, ~, $HOME, $env:USERPROFILE, CLAUDE_CONFIG_DIR, a junction), and data bodies left unread.
// A fake home in a temp directory stands in for the real one: os.homedir() reads USERPROFILE / HOME.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'guard-noise-selfprotect-')));
const home = join(base, 'userprofile-home');
const claude = join(home, '.claude');
const kit = join(base, 'kit-worktree');
const configDir = join(base, 'custom-config-dir');
for (const dir of [join(claude, 'hooks', 'lib'), join(kit, 'hooks', 'lib'), configDir]) mkdirSync(dir, { recursive: true });
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.CLAUDE_CONFIG_DIR = claude;
const require = createRequire(import.meta.url);
const { evaluate } = require('../hooks/lib/guard.js');
after(() => { try { rmSync(base, { recursive: true, force: true }); } catch { /* tmp */ } });

const fwd = (p) => p.replace(/\\/g, '/');
const msys = (p) => fwd(p).replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const CONFIG = /Claude configuration/;
const judge = (command, cwd, tool_name = 'Bash') => evaluate({ tool_name, tool_input: { command }, cwd, session_id: 'noise-test' }) ?? {};
const selfAsks = (r) => r.decision !== undefined && CONFIG.test(r.reason ?? '');

/** The 8.3 short form of a path (the long form when the volume has no short names). */
function shortForm(p) {
  const r = spawnSync('cmd', ['/d', '/s', '/c', `"for %I in ("${p}") do @echo %~sI"`], { encoding: 'utf8', windowsVerbatimArguments: true });
  return r.stdout.trim() || p;
}

test('given cwd ~/.claude and a cd to a worktree outside it, when a relative sed -i is evaluated, then self-protect does not ask', () => {
  // Given
  const command = `cd ${fwd(kit)} && sed -i 's/a/b/' hooks/lib/x.js`;

  // When
  const r = judge(command, claude);

  // Then
  assert.ok(!selfAsks(r), r.reason);
});

test('given a quoted heredoc data body naming ~/.claude, when evaluated, then self-protect does not ask', () => {
  // Given
  const command = "cat > scratch.js <<'EOF'\ncp a ~/.claude/settings.json\necho x > ~/.claude/hooks/y.js\nEOF";

  // When
  const r = judge(command, kit);

  // Then
  assert.ok(!selfAsks(r), r.reason);
});

test('given a cd to the msys form of the home .claude, when a relative sed -i follows, then it asks', () => {
  // Given
  const command = `cd ${msys(claude)} && sed -i 's/a/b/' hooks/x.js`;

  // When
  const r = judge(command, kit);

  // Then
  assert.ok(selfAsks(r), command);
});

test('given a cd to the 8.3 short form of the home .claude, when a relative write follows, then it asks', { skip: process.platform !== 'win32' }, () => {
  // Given
  const command = `Set-Location ${shortForm(claude)}; Set-Content hooks\\x.js y`;

  // When
  const r = judge(command, kit, 'PowerShell');

  // Then
  assert.ok(selfAsks(r), command);
});

test('given a cd to ~/.claude, $HOME/.claude or $env:USERPROFILE\\.claude, when a relative write follows, then each asks', () => {
  // Given
  const cases = [
    ['Bash', "cd ~/.claude && sed -i 's/a/b/' hooks/x.js"],
    ['Bash', "cd $HOME/.claude && sed -i 's/a/b/' hooks/x.js"],
    ['PowerShell', 'Set-Location $env:USERPROFILE\\.claude; Set-Content hooks\\x.js y'],
  ];
  for (const [tool, command] of cases) {
    // When
    const r = judge(command, kit, tool);

    // Then
    assert.ok(selfAsks(r), `${tool}: ${command}`);
  }
});

test('given a variable holding ~/.claude, when cd $X is followed by a write, then it asks', () => {
  // Given
  const command = "X=~/.claude; cd $X && sed -i 's/a/b/' hooks/x.js";

  // When
  const r = judge(command, kit);

  // Then
  assert.ok(selfAsks(r), command);
});

test('given cwd ~/.claude and a cd to a missing directory joined by ;, when a relative write follows, then it asks', () => {
  // Given
  const command = "cd /nonexistent; sed -i 's/a/b/' hooks/x.js";

  // When
  const r = judge(command, claude);

  // Then
  assert.ok(selfAsks(r), command);
});

test('given cwd ~/.claude and a cd joined by |, & or ||, when a relative write follows, then the cd is not adopted and it asks', () => {
  // Given
  const cases = ['|', '&', '||'].map((sep) => `cd ${fwd(kit)} ${sep} sed -i 's/a/b/' hooks/x.js`);
  for (const command of cases) {
    // When
    const r = judge(command, claude);

    // Then
    assert.ok(selfAsks(r), command);
  }
});

test('given cwd ~/.claude and a subshell cd, popd, cd - or cd .., when a relative write follows, then both cwds are checked and it asks', () => {
  // Given
  const k = fwd(kit);
  const cases = [
    `(cd ${k}); sed -i 's/a/b/' hooks/x.js`,
    `pushd ${k}; popd; sed -i 's/a/b/' hooks/x.js`,
    `cd ${k} && cd - && sed -i 's/a/b/' hooks/x.js`,
    `cd ${k} && cd .. && sed -i 's/a/b/' hooks/x.js`,
  ];
  for (const command of cases) {
    // When
    const r = judge(command, claude);

    // Then
    assert.ok(selfAsks(r), command);
  }
});

test('given cwd ~/.claude and a cd inside bash -c, when the nested write is evaluated, then the nested cd is not adopted and it asks', () => {
  // Given
  const command = `bash -c "cd ${fwd(kit)} && sed -i 's/a/b/' hooks/x.js"`;

  // When
  const r = judge(command, claude);

  // Then
  assert.ok(selfAsks(r), command);
});

test('given Copy-Item with an absolute target in ~/.claude, when evaluated, then it asks', () => {
  // Given
  const cases = [`Copy-Item new.js ${claude}\\hooks\\x.js`, `Copy-Item -Path new.json -Destination ${claude}\\settings.json`];
  for (const command of cases) {
    // When
    const r = judge(command, kit, 'PowerShell');

    // Then
    assert.ok(selfAsks(r), command);
  }
});

test('given a data body whose opening line redirects into ~/.claude/settings.json, when evaluated, then it asks', () => {
  // Given
  const command = "cat > ~/.claude/settings.json <<'EOF'\n{}\nEOF";

  // When
  const r = judge(command, kit);

  // Then
  assert.ok(selfAsks(r), command);
});

test('given an -EncodedCommand payload writing ~/.claude, when evaluated, then it asks', () => {
  // Given
  const payload = Buffer.from('Set-Content -Path ~/.claude/settings.json -Value x', 'utf16le').toString('base64');
  const command = `pwsh -NoProfile -EncodedCommand ${payload}`;

  // When
  const r = judge(command, kit, 'PowerShell');

  // Then
  assert.ok(selfAsks(r), command);
});

test('given CLAUDE_CONFIG_DIR set to another directory, when a write lands under it, then it asks', () => {
  // Given
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDir;
  const cases = [`sed -i 's/a/b/' ${fwd(configDir)}/settings.json`, `echo x > ${fwd(configDir)}/hooks/y.js`];
  try {
    for (const command of cases) {
      // When
      const r = judge(command, kit);

      // Then
      assert.ok(selfAsks(r), command);
    }
  } finally {
    process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('given a junction from a worktree into ~/.claude/hooks, when a write goes through it, then realpath catches it and it asks', () => {
  // Given
  const link = join(kit, 'linked');
  symlinkSync(join(claude, 'hooks'), link, 'junction');
  const command = "sed -i 's/a/b/' linked/x.js";

  // When
  const r = judge(command, kit);

  // Then
  assert.ok(selfAsks(r), command);
});
