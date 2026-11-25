// Tests for hooks/guard-shell.js: heredoc preambles, git options, rm -f and kit script variables. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync, symlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluate, created, fixture, run, onFeature, asks, approves, runTool, DB, NUDGE, seededConfig, runHook, bashOnly, psOnly } from './guard-shell-shared.test.mjs';

const notApproved = (command, cwd) => {
  const { decision } = run(command, cwd ?? onFeature);
  assert.ok(decision === 'ask' || decision === 'deny', `${command} -> ${decision}`);
};
const BODY = 'rm -rf /';

test('given an inert preamble before a data heredoc, when the guard reads it, then it approves', () => {
  // Given
  const commands = [
    `cd C:/repo && cat > d.txt <<'EOF'\n${BODY}\nEOF`,
    `cd C:/repo && node - <<'EOF'\n${BODY}\nEOF`,
    `P=C:/repo/a.txt; cat > "$P" <<'EOF'\n${BODY}\nEOF`,
    `mkdir -p C:/repo/d && cat > C:/repo/d/n.md <<'EOF'\n${BODY}\nEOF`,
  ];

  for (const command of commands) {
    // When / Then
    approves(command);
  }
});

test('given a preamble and a heredoc written to a script, when the script then runs, then the guard still asks', () => {
  // Given
  const runs = ['bash s.sh', 'sh s.sh', 'pwsh -File s.ps1', 'source s.sh', '. s.sh', 'eval "$(cat s.sh)"', './s.sh'];

  for (const next of runs) {
    // When / Then
    notApproved(`cd C:/repo && cat > s.sh <<'EOF'\n${BODY}\nEOF\n${next}`);
  }
  notApproved(`P=s.sh; cat > "$P" <<'EOF'\n${BODY}\nEOF\n"$P"`);
  notApproved(`P=s.sh; cat > "$P" <<'EOF'\n${BODY}\nEOF\n./s.sh`);
});

test('given a heredoc written to a build file on the opener line of dotnet build or test, when the guard reads it, then it still asks', () => {
  // Given: MSBuild imports Directory.Build.targets on its own, so a body written there runs at the build.
  const builds = ['dotnet build', 'dotnet test'];

  for (const next of builds) {
    // When / Then
    notApproved(`cat > Directory.Build.targets <<'EOF'; ${next}\n${BODY}\nEOF`);
  }
});

test('given a preamble and an unquoted heredoc delimiter, when the body substitutes rm -rf, then the guard still asks', () => {
  // Given
  const command = `cd C:/repo && cat > f <<EOF\n$(rm -rf ~)\nEOF`;

  // When / Then
  notApproved(command);
});

test('given a preamble and a heredoc fed to a shell or remote, when the guard reads it, then it still asks', () => {
  // Given
  const commands = [
    `cd C:/repo && bash <<'EOF'\n${BODY}\nEOF`,
    `cd C:/repo && cat <<'EOF' | sh\n${BODY}\nEOF`,
    `cat <<'EOF' | sh\n${BODY}\nEOF`,
    `ssh h <<'EOF'\n${BODY}\nEOF`,
    `docker exec c sh <<'EOF'\n${BODY}\nEOF`,
  ];

  for (const command of commands) {
    // When / Then
    notApproved(command);
  }
});

test('given a command substitution in the preamble or an assigned heredoc, when the guard reads it, then it still asks', () => {
  // Given
  const commands = [
    `cd "$(sh -c 'rm -rf ~')" && cat > f <<'EOF'\nhello\nEOF`,
    `X=$(cat <<'EOF'\n${BODY}\nEOF\n)`,
    `X=$(rm -rf ~); cat > f <<'EOF'\nhello\nEOF`,
  ];

  for (const command of commands) {
    // When / Then
    notApproved(command);
  }
});

test('given a reserved-name assignment before a heredoc, when the guard reads it, then it is not inert', () => {
  // Given
  const commands = [
    `BASH_ENV=s.sh; cat > f <<'EOF'\n${BODY}\nEOF\nbash -c true`,
    `IFS=x; cat > s.sh <<'EOF'\n${BODY}\nEOF\nsh s.sh`,
    `BASH_ENV=s.sh cat > s.sh <<'EOF'\n${BODY}\nEOF\nsh s.sh`,
  ];

  for (const command of commands) {
    // When / Then
    notApproved(command);
  }
});

test('given an unclosed heredoc, when its text holds rm -rf, then the guard still asks', () => {
  // Given
  const commands = [`cd C:/repo && cat > f <<'EOF'\n${BODY}`, `cat > f <<'EOF'\nhello\n${BODY}`];

  for (const command of commands) {
    // When / Then
    notApproved(command);
  }
});

test('given a preamble, a heredoc write and a later run on one line, when the guard reads it, then it still asks', () => {
  // Given
  const command = `mkdir -p d && cat > d/s.sh <<'EOF' && sh d/s.sh\n${BODY}\nEOF`;

  // When / Then
  notApproved(command);
});

test('given git global options before a searching verb, when the pattern holds a risky text, then the guard approves', () => {
  // Given
  const commands = [
    'git -C C:/repo grep -n "git branch -M main"',
    'git -C C:/repo log --grep "reset --hard"',
    'git -c core.x=y grep "branch -m"',
    "$b='C:/repo'; git -C $b branch -r --contains (git -C $b log -1)",
    'git -C C:/repo branch -r --contains $(git -C C:/repo log -1)',
    'git --no-pager -C C:/repo grep "branch -M a"',
  ];

  for (const command of commands) {
    // When / Then
    approves(command);
  }
});

test('given a real branch rename or force under git options or nesting, when the guard reads it, then it still asks', () => {
  // Given
  const commands = [
    'git -C r branch -C a b',
    'git branch git -C new',
    'git branch $(echo x) -M a b',
    'git branch --list $(git -C r branch -m a b)',
    'git branch -f a b',
    'git branch -fM a b',
    'git branch --move main b',
    'git branch --copy a master',
    'git branch --force a b',
    '(git -C r branch -m main b)',
    'git branch -m `git -C r x` b',
    'git -c k=v branch -M a b',
    'git branch -m main b | git -C r log',
    'git -C r grep x $(git branch -M a b)',
    'rm -rf C:/repo/src',
    'Remove-Item -Recurse x',
    'ls | Remove-Item',
  ];

  for (const command of commands) {
    // When / Then
    notApproved(command);
  }
});

test('given worktree and sed and taskkill commands with dash options, when the guard reads them, then it approves', () => {
  // Given
  const commands = ['git worktree add -q C:/repo-wt -b x', 'sed -i "s/-f/x/" f', 'taskkill //IM a.exe //F'];

  for (const command of commands) {
    // When / Then
    approves(command);
  }
});

/** A git worktree fixture holding a.txt and sub/b.txt, plus a directory and an outside file. */
function rmFixture() {
  const root = fixture('feature/x', 'main', 'guard-rm-');
  writeFileSync(join(root, 'a.txt'), 'a');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'b.txt'), 'b');
  mkdirSync(join(root, 'dir'));
  const outside = mkdtempSync(join(tmpdir(), 'guard-out-'));
  created.push(outside);
  writeFileSync(join(outside, 'x'), 'x');
  return { root, outside };
}

test('given a git worktree and existing regular files, when rm -f removes them, then the guard approves', () => {
  // Given
  const { root } = rmFixture();

  // When
  const { decision } = run('rm -f a.txt sub/b.txt', root);

  // Then
  assert.equal(decision, 'approve');
});

test('given rm -f outside the single-file shape, when the guard reads it, then it still asks', () => {
  // Given
  const { root, outside } = rmFixture();
  const cases = [
    ['rm -rf a.txt', root],
    ['rm -f ../outside.txt', join(root, 'sub')],
    [`rm -f ${join(outside, 'x').replaceAll(String.fromCharCode(92), '/')}`, root],
    ['rm -f *.txt', root],
    ['rm -f $X', root],
    ['rm -f .git/index', root],
    ['rm -f dir', root],
    ['rm -f missing.txt', root],
    ['rm -f a.txt', outside],
    ['rm -f a.txt; rm -rf b', root],
    ['Remove-Item -Force a.txt', root],
  ];

  for (const [command, cwd] of cases) {
    // When / Then
    notApproved(command, cwd);
  }
});

test('given a symlink target, when rm -f removes it, then the guard still asks', (t) => {
  // Given
  const { root } = rmFixture();
  try { symlinkSync(join(root, 'a.txt'), join(root, 'link.txt')); } catch { t.skip('no symlink right'); return; }

  // When / Then
  notApproved('rm -f link.txt', root);
});

test('given a variable assigned once to a literal path, when a kit script is called with it in double quotes, then the guard does not deny', () => {
  // Given
  const cases = [
    ['Bash', `A=src/app; ${DB} -Db "$A/x.ts,$A/y.ts"`],
    ['Bash', `A=src; ${DB} -Db "\${A}/x.ts"`],
    ['Bash', `git status; mkdir -p out; A=src; ${DB} -Db "$A/x.ts"`],
    ['PowerShell', `$b='src/app'; ${DB} -Db "$b/x.ts"`],
    ['PowerShell', `$b='src/app'; ${DB} -Db "$B/x.ts"`],
    ['PowerShell', String.raw`$b='C:\repo\src'; ${DB} -Db "$b"`],
  ];

  for (const [tool, command] of cases) {
    // When
    const { decision } = runTool(tool, command);
    // Then
    assert.notEqual(decision, 'deny', `${tool}: ${command}`);
  }
});

test('given a variable resolved to a grant or internal flag, when a kit script is called with it, then the guard asks', () => {
  // Given
  const commands = [
    `G=-AcceptWriteGrant; ${DB} -Env dev "$G"`,
  ];

  for (const command of commands) {
    // When / Then
    assert.equal(bashOnly(command), 'ask', command);
  }
});

test('given an assignment value with a risky character, when a kit script is called with the variable, then the guard does not approve', () => {
  // Given
  const values = [`'a b'`, `'a;b'`, `'a*'`, `'a?'`, `'a[1]'`, `'$x'`, "'a`b'", `'(x)'`, `"it's"`, `'$(x)'`];

  for (const value of values) {
    // When / Then
    notApproved(`A=${value}; ${DB} -Db "$A"`);
  }
});

test('given a variable that is assigned again, read, declared or unset, when a kit script is called with it, then the guard does not approve', () => {
  // Given
  const heads = ['A=x; A=y', 'A=x; A+=y', 'A=x; read A', 'for A in x y; do :; done; A=x', 'A=x; printf -v A y', 'A=x; declare -n A=B',
    'A=x; readonly A', 'A=x; unset A', 'export A=$(echo x)', 'A=x; export A=$(echo y)'];

  for (const head of heads) {
    // When / Then
    notApproved(`${head}; ${DB} -Db "$A"`);
  }
});

test('given a prefix assignment, an assignment behind an operator or a group, when a kit script is called with the variable, then the guard does not approve', () => {
  // Given
  const commands = [
    `echo hi | A=x; ${DB} -Db "$A"`,
    `A=x & ${DB} -Db "$A"`,
    `false || A=x; ${DB} -Db "$A"`,
    `(A=x); ${DB} -Db "$A"`,
    `{ A=x; }; ${DB} -Db "$A"`,
    `${DB} -Db "$A"; A=x`,
    `${DB} -Db "$A" "$(whoami)"; A=x`,
    `A=x; ${DB} -Db "$A" "$(whoami)"`,
  ];

  for (const command of commands) {
    // When / Then
    notApproved(command);
  }
});

test('given a segment that may change the variable, when a kit script is called with it, then the guard does not approve', () => {
  // Given
  const commands = [
    `A=x; source f.sh; ${DB} -Db "$A"`,
    `A=x; . f.sh; ${DB} -Db "$A"`,
    `A=x; eval 'A=y'; ${DB} -Db "$A"`,
    `A=x; f() { A=y; }; f; ${DB} -Db "$A"`,
    `A=x; echo hi | cat; ${DB} -Db "$A"`,
    `IFS=/; A=x; ${DB} -Db "$A"`,
    `A=x; PATH=/tmp; ${DB} -Db "$A"`,
    `BASH_ENV=f; A=x; ${DB} -Db "$A"`,
    String.raw`A=C:\x; ${DB} -Db "$A"`,
    `a=x; ${DB} -Db "$A"`,
  ];

  for (const command of commands) {
    // When / Then
    notApproved(command);
  }
});

test('given a PowerShell variable that may change or is read in a form the check cannot follow, when a kit script is called with it, then the guard does not approve', () => {
  // Given
  const commands = [
    `$b='x'; iex 'x'; ${DB} -Db "$b"`,
    `$b='x'; Set-Variable b y; ${DB} -Db "$b"`,
    `$b='x'; Get-Item f -OutVariable b; ${DB} -Db "$b"`,
    `$b='x'; ${DB} -Db "$b:x"`,
    `$b='x'; ${DB} -Db "$b.Length"`,
    `$b='x'; ${DB} -Db "$b[0]"`,
    `$b='x'; ${DB} -Db "$($b)"`,
    `$script:b='x'; ${DB} -Db "$b"`,
    `$global:b='x'; ${DB} -Db "$b"`,
    `$env:A='x'; ${DB} -Db "$env:A"`,
    `$b='x'; $B=(gc f); ${DB} -Db "$b"`,
    `$b='x'; $b='y'; ${DB} -Db "$b"`,
    `$b='x y'; ${DB} -Db "$b"`,
  ];

  for (const command of commands) {
    // When / Then
    assert.notEqual(psOnly(command), 'approve', command);
  }
});

const CD_HINT = /\bcd\b.*git -C/i;
const hintFileNames = (config) => (existsSync(join(config, '.cache')) ? readdirSync(join(config, '.cache')).filter((name) => name.startsWith('cd-hint-s1-')) : []);
const emptyConfig = () => {
  const config = mkdtempSync(join(tmpdir(), 'guard-cdhint-'));
  created.push(config);
  return config;
};

test('given an allowed call that starts with cd, when it is evaluated twice in a session, then the hint appears the first time only', () => {
  for (const command of ['cd C:/repo && git status', 'cd "C:/Program Files/x" && ls', "pushd 'C:/repo'; git status"]) {
    // Given
    const config = emptyConfig();
    // When
    const first = runHook(config, command);
    const second = runHook(config, command);
    // Then
    assert.match(first?.additionalContext ?? '', CD_HINT, command);
    assert.equal(first.permissionDecision, undefined, command);
    assert.equal(second, null, command);
    assert.equal(hintFileNames(config).length, 1, command);
  }
});

test('given a call that does not start with cd, when it is evaluated, then there is no hint and no flag file', () => {
  for (const command of ['git -C C:/repo status', 'echo cd C:/repo && ls', 'cd C:/repo', 'ls && cd C:/repo && ls']) {
    // Given
    const config = emptyConfig();
    // When
    const out = runHook(config, command);
    // Then
    assert.equal(out?.additionalContext, undefined, command);
    assert.deepEqual(hintFileNames(config), [], command);
  }
});

test('given a subagent and the main session, when each starts a call with cd, then the subagent is denied and the main session gets the hint once', () => {
  // Given
  const config = emptyConfig();
  const sub = { agent_id: 'a1', agent_type: 'implementer' };
  // When
  const denied = runHook(config, 'cd C:/repo && git status', sub);
  const main = runHook(config, 'cd C:/repo && git status');
  const again = runHook(config, 'cd C:/repo && git status');
  // Then
  assert.equal(denied?.permissionDecision, 'deny');
  assert.match(main?.additionalContext ?? '', CD_HINT);
  assert.equal(again, null);
  assert.deepEqual(hintFileNames(config).map((name) => name.startsWith('cd-hint-s1-main')), [true]);
});

test('given a fifth single call that starts with cd, when the guard answers, then the context carries the nudge and the hint', () => {
  // Given
  const config = seededConfig();
  // When
  const out = runHook(config, 'cd C:/repo && git status');
  // Then
  assert.ok(out.additionalContext.includes(NUDGE));
  assert.match(out.additionalContext, CD_HINT);
});

test('given a cd call before a test run, when the guard answers, then the output filter leaves it alone and the context carries the hint', () => {
  // Given
  const config = emptyConfig();
  // When
  const out = runHook(config, 'cd C:/repo && dotnet test');
  // Then
  assert.equal(out.permissionDecision, undefined);
  assert.equal(out.updatedInput, undefined);
  assert.match(out.additionalContext ?? '', CD_HINT);
});

test('given a cd call that asks or is denied, when the guard answers, then there is no hint, no flag file and the decision is unchanged', () => {
  // Given
  const config = emptyConfig();
  const cases = [['cd C:/repo && docker compose down -v', 'ask'], [`cd C:/repo && ${DB} -Env prod -Query "$(whoami)"`, 'deny']];

  for (const [command, decision] of cases) {
    // When
    const out = runHook(config, command);
    // Then
    assert.equal(out.permissionDecision, decision, command);
    assert.equal(out.additionalContext, undefined, command);
  }
  assert.deepEqual(hintFileNames(config), []);
});

test('given a cd-hint flag idle for two hours, when a call earns no hint, then it is pruned', () => {
  // Given
  const config = emptyConfig();
  mkdirSync(join(config, '.cache'), { recursive: true });
  const stale = join(config, '.cache', 'cd-hint-s1-old');
  writeFileSync(stale, '1\n');
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(stale, twoHoursAgo, twoHoursAgo);
  // When
  runHook(config, 'git status');
  // Then
  assert.equal(existsSync(stale), false);
});
