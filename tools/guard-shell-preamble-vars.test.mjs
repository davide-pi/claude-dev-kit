// Tests for hooks/guard-shell.js: heredoc preambles, git options, rm -f and kit script variables. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync, symlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluate, created, fixture, run, onFeature, asks, approves, runTool, DB, PERIMETER, GATE, NUDGE, seededConfig, runHook, GATE_CALL, bashOnly, psOnly } from './guard-shell-shared.test.mjs';

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
    'git branch --move a b',
    'git branch --copy a b',
    'git branch --force a b',
    '(git -C r branch -m a b)',
    'git branch -m `git -C r x` b',
    'git -c k=v branch -M a b',
    'git branch -m a b | git -C r log',
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
    ['Bash', `A=src/app; ${PERIMETER} -Files "$A/x.ts,$A/y.ts"`],
    ['Bash', `A=src; ${PERIMETER} -Files "\${A}/x.ts"`],
    ['Bash', `W=C:/repo; ${GATE_CALL} --root "$W" --test "npm test"`],
    ['Bash', `cd C:/repo && W=C:/repo && ${GATE_CALL} --root "$W" --test "npm test"`],
    ['Bash', `git status; mkdir -p out; A=src; ${PERIMETER} -Files "$A/x.ts"`],
    ['PowerShell', `$b='src/app'; ${PERIMETER} -Files "$b/x.ts"`],
    ['PowerShell', `$b='src/app'; ${PERIMETER} -Files "$B/x.ts"`],
    ['PowerShell', String.raw`$b='C:\repo\src'; ${PERIMETER} -Files "$b"`],
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
    `R=--run; ${GATE_CALL} --root C:/repo "$R"`,
    `R=--lane-remove; ${GATE_CALL} --root C:/repo "$R"`,
    `R=curl; ${GATE_CALL} --root C:/repo --test "$R"`,
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
    notApproved(`A=${value}; ${PERIMETER} -Files "$A"`);
  }
});

test('given a variable that is assigned again, read, declared or unset, when a kit script is called with it, then the guard does not approve', () => {
  // Given
  const heads = ['A=x; A=y', 'A=x; A+=y', 'A=x; read A', 'for A in x y; do :; done; A=x', 'A=x; printf -v A y', 'A=x; declare -n A=B',
    'A=x; readonly A', 'A=x; unset A', 'export A=$(echo x)', 'A=x; export A=$(echo y)'];

  for (const head of heads) {
    // When / Then
    notApproved(`${head}; ${PERIMETER} -Files "$A"`);
  }
});

test('given a prefix assignment, an assignment behind an operator or a group, when a kit script is called with the variable, then the guard does not approve', () => {
  // Given
  const commands = [
    `echo hi | A=x; ${PERIMETER} -Files "$A"`,
    `A=x & ${PERIMETER} -Files "$A"`,
    `false || A=x; ${PERIMETER} -Files "$A"`,
    `(A=x); ${PERIMETER} -Files "$A"`,
    `{ A=x; }; ${PERIMETER} -Files "$A"`,
    `${PERIMETER} -Files "$A"; A=x`,
    `${PERIMETER} -Files "$A" "$(whoami)"; A=x`,
    `A=x; ${PERIMETER} -Files "$A" "$(whoami)"`,
  ];

  for (const command of commands) {
    // When / Then
    notApproved(command);
  }
});

test('given a segment that may change the variable, when a kit script is called with it, then the guard does not approve', () => {
  // Given
  const commands = [
    `A=x; source f.sh; ${PERIMETER} -Files "$A"`,
    `A=x; . f.sh; ${PERIMETER} -Files "$A"`,
    `A=x; eval 'A=y'; ${PERIMETER} -Files "$A"`,
    `A=x; f() { A=y; }; f; ${PERIMETER} -Files "$A"`,
    `A=x; echo hi | cat; ${PERIMETER} -Files "$A"`,
    `IFS=/; A=x; ${PERIMETER} -Files "$A"`,
    `A=x; PATH=/tmp; ${PERIMETER} -Files "$A"`,
    `BASH_ENV=f; A=x; ${PERIMETER} -Files "$A"`,
    String.raw`A=C:\x; ${PERIMETER} -Files "$A"`,
    `a=x; ${PERIMETER} -Files "$A"`,
  ];

  for (const command of commands) {
    // When / Then
    notApproved(command);
  }
});

test('given a PowerShell variable that may change or is read in a form the check cannot follow, when a kit script is called with it, then the guard does not approve', () => {
  // Given
  const commands = [
    `$b='x'; iex 'x'; ${PERIMETER} -Files "$b"`,
    `$b='x'; Set-Variable b y; ${PERIMETER} -Files "$b"`,
    `$b='x'; Get-Item f -OutVariable b; ${PERIMETER} -Files "$b"`,
    `$b='x'; ${PERIMETER} -Files "$b:x"`,
    `$b='x'; ${PERIMETER} -Files "$b.Length"`,
    `$b='x'; ${PERIMETER} -Files "$b[0]"`,
    `$b='x'; ${PERIMETER} -Files "$($b)"`,
    `$script:b='x'; ${PERIMETER} -Files "$b"`,
    `$global:b='x'; ${PERIMETER} -Files "$b"`,
    `$env:A='x'; ${PERIMETER} -Files "$env:A"`,
    `$b='x'; $B=(gc f); ${PERIMETER} -Files "$b"`,
    `$b='x'; $b='y'; ${PERIMETER} -Files "$b"`,
    `$b='x y'; ${PERIMETER} -Files "$b"`,
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

test('given a subagent and the main session, when each starts a call with cd, then each gets the hint once under its own flag file', () => {
  // Given
  const config = emptyConfig();
  const sub = { agent_id: 'a1', agent_type: 'implementer' };
  // When
  const first = runHook(config, 'cd C:/repo && git status', sub);
  const again = runHook(config, 'cd C:/repo && git status', sub);
  const main = runHook(config, 'cd C:/repo && git status');
  // Then
  assert.match(first?.additionalContext ?? '', CD_HINT);
  assert.equal(again, null);
  assert.match(main?.additionalContext ?? '', CD_HINT);
  assert.equal(hintFileNames(config).length, 2);
  assert.ok(hintFileNames(config).some((name) => name.startsWith('cd-hint-s1-a1')));
  assert.ok(hintFileNames(config).some((name) => name.startsWith('cd-hint-s1-main')));
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
