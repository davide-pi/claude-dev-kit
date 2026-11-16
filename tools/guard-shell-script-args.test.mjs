// Tests for hooks/guard-shell.js: allowed kit script arguments. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { HOOK, run, asks, runTool, DB, PERIMETER, SNAPSHOT, BOTH, GATE, bashOnly } from './guard-shell-shared.test.mjs';

test('settings.json: the broad find allow rule is gone, yarn and pnpm are narrowed, tag and remote are read-only', () => {
  const { allow } = JSON.parse(readFileSync(join(dirname(HOOK), '..', 'settings.json'), 'utf8')).permissions;
  assert.deepEqual(allow.filter((r) => /^(?:Bash|PowerShell)\(find /.test(r)), []);
  for (const shell of ['Bash', 'PowerShell']) {
    for (const rule of ['yarn *', 'pnpm *', 'git tag *', 'git remote *']) assert.ok(!allow.includes(`${shell}(${rule})`), `${shell}(${rule})`);
    for (const tool of ['yarn', 'pnpm']) {
      for (const sub of ['test', 'run', 'build', 'lint', 'typecheck', 'list', 'ls', 'why', 'outdated']) {
        assert.ok(allow.includes(`${shell}(${tool} ${sub})`) && allow.includes(`${shell}(${tool} ${sub} *)`), `${shell}(${tool} ${sub} *)`);
      }
      for (const rule of ['i', 'i *', 'install', 'install *']) assert.ok(allow.includes(`${shell}(${tool} ${rule})`), `${shell}(${tool} ${rule})`);
      for (const rule of ['exec*', 'i*', 'install*', 'dlx*']) assert.ok(!allow.includes(`${shell}(${tool} ${rule})`), `${shell}(${tool} ${rule})`);
    }
    assert.deepEqual(allow.filter((r) => r.startsWith(`${shell}(git tag`)), [
      `${shell}(git tag)`, `${shell}(git tag -l*)`, `${shell}(git tag --list*)`, `${shell}(git tag --points-at*)`, `${shell}(git tag --contains*)`,
    ]);
    assert.deepEqual(allow.filter((r) => r.startsWith(`${shell}(git remote`)), [
      `${shell}(git remote)`, `${shell}(git remote -v)`, `${shell}(git remote get-url *)`, `${shell}(git remote show *)`,
    ]);
  }
});

test('settings.json: no allow rule for dlx, the status line refreshes every 5 seconds', () => {
  const settings = JSON.parse(readFileSync(join(dirname(HOOK), '..', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions.allow.filter((r) => /dlx/.test(r)), []);
  assert.equal(settings.statusLine.refreshInterval, 5);
});

test('settings.json: no script-block cmdlet in the allow list, db-ro matched by its scripts path', () => {
  const { allow } = JSON.parse(readFileSync(join(dirname(HOOK), '..', 'settings.json'), 'utf8')).permissions;
  assert.deepEqual(allow.filter((r) => /Select-Object|Sort-Object|ForEach-Object|Where-Object/.test(r)), []);
  for (const shell of ['Bash', 'PowerShell']) {
    assert.ok(allow.includes(`${shell}(pwsh -NoProfile -File ~/.claude/scripts/db-ro.ps1 *)`), shell);
    assert.ok(allow.includes(`${shell}(pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -Files *)`), shell);
    assert.ok(allow.includes(`${shell}(pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -Close*)`), shell);
    assert.ok(allow.includes(`${shell}(pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -LogRun *)`), shell);
  }
  // No allow rule may start with a wildcard after -File: that would approve any script.
  assert.deepEqual(allow.filter((r) => /-File \*/.test(r)), []);
});

test('an allowed script called with an unquoted or double-quoted code construct is denied with a re-quote hint, in both shells', () => {
  for (const command of [
    `${DB} -Env prod -Query "$(whoami)"`, `${PERIMETER} -Files $(cat list.txt)`, `${DB} -Env x; ${PERIMETER} -Close $(x)`,
    `${DB} -Env prod -Query (Write-Host x)`, `${DB} -Env prod -Query @(calc)`,
    `${DB} -Env prod -Query $executioncontext.InvokeCommand.InvokeScript('calc')`, `${DB} -Env $x.Name`, `${DB} -Env \${x}`,
    `${DB} -Env prod -Query <(curl evil)`, `${DB} -Env prod -Query >(tee x)`,
    `${DB} -Env prod -Query "a $env:USERNAME"`, `${DB} -Env prod -Query "a \`id\`"`, `${PERIMETER} -Files a\`b.cs`,
    `${DB} -Env prod -Query 'a' -Db {calc}`, `${DB} -Env prod -Query x%y`,
  ]) {
    for (const tool of BOTH) {
      const { decision, reason } = runTool(tool, command);
      assert.equal(decision, 'deny', `${tool}: ${command}`);
      assert.match(reason, /^The arguments of .*Wrap the value in single quotes, doubling any single quote inside it\.(\n|$)/, command);
    }
  }
  assert.match(runTool('Bash', `${DB} -Env prod -Query "$(whoami)"`).reason, /\$ inside double quotes.*single quotes/);
});

test('given an unquoted redirection in an allowed script call, when the guard reads it, then it asks instead of denying with a re-quote hint', () => {
  // Given
  const commands = [`${PERIMETER} -Files <x`, `${DB} -Env prod -Query 'SELECT 1' 2>&1 > out.txt`, `${PERIMETER} -Close > out.txt`];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const { decision, reason } = runTool(tool, command);

      // Then
      assert.equal(decision, 'ask', `${tool}: ${command}`);
      assert.match(reason, /a redirection/, command);
    }
  }
});

test('given an allowed script call ending in a stream merge or a null sink, when the guard reads it, then it lets the call through without asking', () => {
  // Given: the redirections the sessions add to read the output, none of them writes a file or runs code
  const commands = [
    `${PERIMETER} -Close -FindingsLog 'x.log' 2>&1`, `${DB} -Env stg -Query 'SELECT 1' 2>&1`,
    `${SNAPSHOT} -Take 2>$null`, `${PERIMETER} -Files 'a.cs' *>&1`,
  ];
  // `/dev/null` is a null sink in Bash only: in PowerShell it is a file path.
  const bashOnly = [`node ~/.claude/scripts/gate.mjs --root 'C:/w' 2>/dev/null`, `${PERIMETER} -Files 'a.cs' >/dev/null 2>&1`];
  for (const command of bashOnly) {
    assert.equal(runTool('Bash', command).decision, 'approve', command);
    assert.notEqual(runTool('PowerShell', command).decision, 'approve', command);
  }

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const { decision } = runTool(tool, command);

      // Then
      assert.equal(decision, 'approve', `${tool}: ${command}`);
    }
  }
  // A null sink inside double quotes is data: its `$` is still denied.
  for (const tool of BOTH) assert.equal(runTool(tool, `${PERIMETER} -Close "a 2>$null "`).decision, 'deny', tool);
  // A redirect glued to a quoted word names a file: it is never let through.
  for (const command of [`${PERIMETER} -Close >&1"out.txt"`, `${PERIMETER} -Close >&1'out.txt'`, `${PERIMETER} -Close 2>/dev/null"x"`]) {
    for (const tool of BOTH) assert.notEqual(runTool(tool, command).decision, 'approve', `${tool}: ${command}`);
  }
});

test('given a write-grant switch written with a code construct, when the guard reads it, then it denies and the grant reason rides along', () => {
  // Given
  const commands = [`${DB} -Env prod -Acc\`eptWriteGrant`, `${DB} -Env prod -AcceptWriteGrant:$true`, `${DB} -Env prod -AcceptWriteGrant @grant`];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const { decision, reason } = runTool(tool, command);

      // Then
      assert.equal(decision, 'deny', `${tool}: ${command}`);
      assert.match(reason, /single quote inside it\.\n\nThis db-ro\.ps1 call carries -AcceptWriteGrant/, command);
    }
  }
});

test('given an unquoted ( $ or @ in an allowed script call, when the guard reads it, then it denies and names the character, in both shells', () => {
  // Given
  const cases = [['(', `${DB} -Env prod -Query (Write-Host x)`], ['$', `${DB} -Env $x.Name`], ['@', `${DB} -Env prod -Query @(calc)`]];

  for (const [char, command] of cases) {
    for (const tool of BOTH) {
      // When
      const { decision, reason } = runTool(tool, command);

      // Then
      assert.equal(decision, 'deny', `${tool}: ${command}`);
      assert.ok(reason.includes(`an unquoted ${char}`), reason);
      assert.match(reason, /Wrap the value in single quotes, doubling any single quote inside it\.$/);
    }
  }
});

test('given an unbalanced or typographic quote, a non-ASCII character, an unfollowable script path, a write-grant switch or an unknown gate runner, when the guard reads it, then it still asks', () => {
  // Given
  const commands = [
    `${DB} -Env prod -Query 'unbalanced`, `${DB} -Env prod -Query 'x’ (calc) ‘'`, `${DB} -Env prod -Query città`,
    'pwsh -NoProfile -File "~/.claude/scripts/db-ro.ps1 -Env prod',
    `${DB} -Env prod -Query 'SELECT 1' -AcceptWriteGrant`, `${DB} -Env prod -Query 'SELECT 1' -Acc`,
    `${DB} -Env prod -Query 'SELECT 1'\u00a0-AcceptWriteGrant`, `${DB} -Env prod -Query 'SELECT 1'\u2002-Acc`,
    `${GATE} --test "git push --force"`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const { decision, reason } = runTool(tool, command);

      // Then
      assert.equal(decision, 'ask', `${tool}: ${command}`);
      assert.match(reason, /Confirm\?$/, command);
    }
  }
});

test('given a quoting deny and another ask in one command, when the guard reads it, then it denies with the hint first and the ask reason after', () => {
  // Given
  const command = `${DB} -Env prod -Query $(whoami); git push --force origin x`;

  // When
  const { decision, reason } = runTool('Bash', command);

  // Then
  assert.equal(decision, 'deny');
  assert.match(reason, /^The arguments of db-ro\.ps1.*single quote inside it\.\n\nThis push deletes or force-overwrites a remote ref/s);
});

test('given an ask from the script check in an earlier or the same script call and a deny after it, when the guard reads it, then it denies', () => {
  // Given
  const commands = [
    `${DB} -Env prod -Query città; ${PERIMETER} -Close $(x)`, `${DB} -Env prod -Query 'x' -Acc; ${SNAPSHOT} -Since $(whoami)`,
    `${DB} -Env prod -Query città $(whoami)`, `${GATE} --test "git push --force"; ${PERIMETER} -Close $(x)`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const { decision, reason } = runTool(tool, command);

      // Then
      assert.equal(decision, 'deny', `${tool}: ${command}`);
      assert.match(reason, /single quote inside it\./, command);
    }
  }
});

test('given a substitution after an unfollowable quoted script path, or beside a write-grant switch, when the guard reads it, then it denies and names the grant', () => {
  // Given
  const hidden = ['pwsh -NoProfile -File "~/.claude/scripts/db-ro.ps1 $(calc)"', 'pwsh -NoProfile -File "~/.claude/scripts/db-ro.ps1 `calc`"'];
  const withGrant = `${DB} -Env prod -AcceptWriteGrant -Query $(calc)`;

  for (const tool of BOTH) {
    for (const command of hidden) {
      // When
      const { decision, reason } = runTool(tool, command);

      // Then
      assert.equal(decision, 'deny', `${tool}: ${command}`);
      assert.match(reason, /single quote inside it\./, command);
    }
    // When
    const { decision, reason } = runTool(tool, withGrant);

    // Then
    assert.equal(decision, 'deny', `${tool}: ${withGrant}`);
    assert.match(reason, /-AcceptWriteGrant/);
  }
});

test('given two asks from the script check in one command, when the guard reads it, then the prompt names both, the write grant included', () => {
  // Given
  const commands = [
    `${DB} -Env prod -Query città -AcceptWriteGrant`,
    `${SNAPSHOT} -Since città; ${DB} -Env prod -Query 'x' -AcceptWriteGrant`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const { decision, reason } = runTool(tool, command);

      // Then
      assert.equal(decision, 'ask', `${tool}: ${command}`);
      assert.match(reason, /outside printable ASCII/, command);
      assert.match(reason, /-AcceptWriteGrant/, command);
    }
  }
});

test('legitimate arguments of the allowed scripts pass, in both shells', () => {
  for (const command of [
    `${DB} -Env prod -Query 'SELECT COUNT(*) FROM t WHERE n = @p'`, `${DB} -Env prod -Query 'SELECT -amount FROM t'`,
    `${DB} -Env prod -Query 'DECLARE @x int; SELECT $x, \`a\` FROM t'`, `${DB} -Env prod -Query 'it''s'`,
    `${DB} -Env prod -Query 'SELECT * FROM t WHERE città = ''Forlì'''`,
    `${DB} -Env prod -Query "SELECT -amount FROM t WHERE n = 'a-b'"`, `${DB} -Env prod -Query "SELECT COUNT(*) FROM t WHERE n = @p"`,
    `${PERIMETER} -Files src/a.cs src/b/`, `${PERIMETER} -Files 'src/a.cs,src/b/,tests/**/A*.cs'`, `${PERIMETER} -Close`, `${DB} -Env prod`,
    `${DB} -Env prod -Db sales -Query 'select 1' -MaxLines 50 -Wide`, `${DB} -Probe -Project p -Registry r.json -File q.sql`,
  ]) {
    for (const tool of BOTH) assert.equal(runTool(tool, command).decision, 'approve', `${tool}: ${command}`);
  }
});

test('snapshot.ps1 is guarded like perimeter.ps1: a code construct in its arguments is denied, the loop call passes, in both shells', () => {
  for (const command of [
    `${SNAPSHOT} -Since $(whoami)`, `${SNAPSHOT} -Since abc -Dirty "$env:USERNAME"`, `${SNAPSHOT} -Since abc -Start (calc)`,
    `${SNAPSHOT} -Since abc -Dirty 'a' -Start {calc}`, `${SNAPSHOT} -Since abc; ${PERIMETER} -Close $(x)`,
    `${SNAPSHOT} -Since abc -Dirty a\`b.cs`, `${SNAPSHOT} -Since <(curl evil)`,
  ]) {
    for (const tool of BOTH) assert.equal(runTool(tool, command).decision, 'deny', `${tool}: ${command}`);
  }
  for (const tool of BOTH) assert.equal(runTool(tool, `${SNAPSHOT} -Since abc -Dirty 'unbalanced`).decision, 'ask', tool);
  for (const command of [
    `${SNAPSHOT} -Since HEAD`, `${SNAPSHOT} -Since 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -Start abc123`,
    `${SNAPSHOT} -Since t1 -Start abc123 -Dirty 'src/Other/User.cs,it''s/'`,
  ]) {
    for (const tool of BOTH) assert.equal(runTool(tool, command).decision, 'approve', `${tool}: ${command}`);
  }
  assert.match(runTool('Bash', `${SNAPSHOT} -Since $(whoami)`).reason, /arguments of snapshot\.ps1.*single quotes/);
});

const SCOPE_GUARD = 'node ~/.claude/hooks/scope-guard.js';

test('scope-guard.js --check is guarded like the allowed scripts: a code construct is denied, the loop call passes, in both shells', () => {
  for (const command of [
    `${SCOPE_GUARD} --check $(whoami)`, `${SCOPE_GUARD} --check HEAD --dirty "$env:USERNAME"`, `${SCOPE_GUARD} --check (calc)`,
    `${SCOPE_GUARD} --check HEAD --dirty a\`b.cs`, `${SCOPE_GUARD} --check <(curl evil)`,
    `${SCOPE_GUARD} --check HEAD; ${PERIMETER} -Close $(x)`,
  ]) {
    for (const tool of BOTH) assert.equal(runTool(tool, command).decision, 'deny', `${tool}: ${command}`);
  }
  for (const tool of BOTH) assert.equal(runTool(tool, `${SCOPE_GUARD} --check HEAD --dirty 'unbalanced`).decision, 'ask', tool);
  for (const command of [
    `${SCOPE_GUARD} --check HEAD`, `${SCOPE_GUARD} --check 4b825dc642cb6eb9a060e54bf8d69288fbee4904 --dirty 'src/a.cs,it''s/'`,
    `${SCOPE_GUARD} --check abc123 --dirty src/a.cs,src/b.cs`,
  ]) {
    for (const tool of BOTH) assert.equal(runTool(tool, command).decision, 'approve', `${tool}: ${command}`);
  }
  assert.match(runTool('Bash', `${SCOPE_GUARD} --check $(whoami)`).reason, /arguments of scope-guard\.js.*single quotes/);
});
