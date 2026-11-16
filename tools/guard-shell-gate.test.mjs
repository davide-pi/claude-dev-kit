// Tests for hooks/guard-shell.js: gate.mjs, sweep.mjs and settings wiring. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { HOOK, run, asks, approves, runTool, DB, PERIMETER, BOTH, GATE } from './guard-shell-shared.test.mjs';

test('given gate.mjs called with a known test runner, when the guard reads it, then it approves in both shells', () => {
  // Given
  const commands = [
    `${GATE} --test 'dotnet test --logger "console;verbosity=normal"'`,
    `${GATE} --test 'node --test tools/gate.test.mjs'`,
    `${GATE} --red --unit 'npx vitest run' --test-files a.test.ts`,
    `${GATE} --test 'dotnet test -r linux-x64'`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const result = runTool(tool, command);

      // Then
      assert.equal(result.decision, 'approve', `${tool}: ${command}`);
    }
  }
});

test('given gate.mjs called with the build, lint and package runners the loops use, when the guard reads it, then it approves in both shells', () => {
  // Given: the --test values seen most in a week of runs besides the plain test runners
  const commands = [
    `${GATE} --test 'dotnet build src/App.slnx -v:m -p:NuGetAudit=false'`,
    `${GATE} --test 'node tools/validate.mjs'`,
    `${GATE} --test 'claude plugin test mods/cockpit'`,
    `${GATE} --test 'npm --prefix src/WebApi/ClientApp test -- --watch=false --no-coverage'`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const result = runTool(tool, command);

      // Then
      assert.equal(result.decision, 'approve', `${tool}: ${command}`);
    }
  }
});

test('given gate.mjs called with npm --prefix test --include or exec vitest run on relative paths, when the guard reads it, then it approves in both shells', () => {
  // Given
  const commands = [
    `${GATE} --test 'npm --prefix src/ClientApp test -- --include=src/a.spec.ts --include=src/b.spec.ts'`,
    `${GATE} --test 'npm --prefix src/ClientApp run test -- --include=src/a.spec.ts'`,
    `${GATE} --test 'npm --prefix src/ClientApp test -- --watch=false --include=src/a.spec.ts'`,
    `${GATE} --test 'npm --prefix src/ClientApp exec vitest -- run src/a.test.ts src/b'`,
    `${GATE} --red --unit 'npm --prefix x exec vitest -- run a.test.ts' --test-files a.test.ts`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const result = runTool(tool, command);

      // Then
      assert.equal(result.decision, 'approve', `${tool}: ${command}`);
    }
  }
});

test('given gate.mjs called with an include or run path that is absolute, climbs, expands or chains a command, when the guard reads it, then it still asks', () => {
  // Given
  const commands = [
    `${GATE} --test 'npm --prefix x test -- --include=/etc/a.spec.ts'`,
    `${GATE} --test 'npm --prefix x test -- --include=C:/a.spec.ts'`,
    `${GATE} --test 'npm --prefix x test -- --include=//host/share/a.spec.ts'`,
    `${GATE} --test 'npm --prefix x test -- --include=../a.spec.ts'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/../../a.spec.ts'`,
    `${GATE} --test 'npm --prefix x test -- --include=$HOME/a.spec.ts'`,
    `${GATE} --test 'npm --prefix x test -- --include="src/a.spec.ts"'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/a.spec.ts && calc'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/a.spec.ts; calc'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/a.spec.ts | calc'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/a.spec.ts > out.txt'`,
    `${GATE} --test 'npm --prefix x exec vitest -- run /etc/a.test.ts'`,
    `${GATE} --test 'npm --prefix x exec vitest -- run ../a.test.ts'`,
    `${GATE} --test 'npm --prefix x exec vitest -- run src/../../a.test.ts'`,
    `${GATE} --test 'npm --prefix x exec vitest -- run $HOME/a.test.ts'`,
    `${GATE} --test 'npm --prefix x exec vitest -- run "src/a.test.ts"'`,
    `${GATE} --test 'npm --prefix x exec vitest -- run src/a.test.ts && calc'`,
    `${GATE} --test 'npm --prefix x exec vitest -- run src/a.test.ts; calc'`,
    `${GATE} --test 'npm --prefix x exec vitest -- run src/a.test.ts | calc'`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const result = runTool(tool, command);

      // Then
      assert.equal(result.decision, 'ask', `${tool}: ${command}`);
    }
  }
});

test('given gate.mjs called with a hijack flag or an exec target other than vitest on those runners, when the guard reads it, then it still asks', () => {
  // Given
  const commands = [
    `${GATE} --test 'npm --prefix x test --script-shell calc.exe -- --include=src/a.spec.ts'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/a.spec.ts --script-shell=calc.exe'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/a.spec.ts --userconfig=evil'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/a.spec.ts --globalconfig=evil'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/a.spec.ts --node-options=--require=evil'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/a.spec.ts --prefix=evil'`,
    `${GATE} --test 'npm --prefix x --prefix y test -- --include=src/a.spec.ts'`,
    `${GATE} --test 'npm --prefix x test -- --include=src/a.spec.ts -c calc'`,
    `${GATE} --test 'npm --prefix x exec --call calc'`,
    `${GATE} --test 'npm --prefix x exec -c calc'`,
    `${GATE} --test 'npm --prefix x exec vitest -c calc -- run src/a.test.ts'`,
    `${GATE} --test 'npm --prefix x exec vitest --script-shell=calc.exe -- run src/a.test.ts'`,
    `${GATE} --test 'npm --prefix x exec vitest -- run src/a.test.ts --node-options=--require=evil'`,
    `${GATE} --test 'npm --prefix x exec vitest -- run src/a.test.ts --config=evil.ts'`,
    `${GATE} --test 'npm --prefix x exec eslint -- run src/a.test.ts'`,
    `${GATE} --test 'npm --prefix x exec evil-vitest -- run src/a.test.ts'`,
    `${GATE} --test 'npm --prefix x exec vitest-evil -- run src/a.test.ts'`,
    `${GATE} --test 'npm --prefix x exec -- vitest run src/a.test.ts'`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const result = runTool(tool, command);

      // Then
      assert.equal(result.decision, 'ask', `${tool}: ${command}`);
    }
  }
});

test('given gate.mjs called with those runners carrying inline code, when the guard reads it, then it still asks', () => {
  // Given
  const commands = [
    `${GATE} --test 'dotnet build -p:Foo=1'`,
    `${GATE} --test 'dotnet build -p:NuGetAudit=false -t:Evil'`,
    `${GATE} --test 'node -e "x" tools/validate.mjs'`,
    `${GATE} --test 'node --import data:x tools/validate.mjs'`,
    `${GATE} --test 'npm --prefix x test --script-shell calc.exe'`,
    `${GATE} --test 'claude plugin test x && calc'`,
    `${GATE} --test 'claude plugin test ../evil'`,
    `${GATE} --test 'claude plugin test --x'`,
    `${GATE} --test 'node ~/.claude/scripts/gate.mjs --lane-remove'`,
    `${GATE} --test 'node src/gate.mjs --run'`,
    `${GATE} --test 'node //host/share/x.js'`,
    `${GATE} --test 'node ../../x.js'`,
    `${GATE} --test 'node C:/x.js'`,
    `${GATE} --test 'npm --prefix ../../x test'`,
    `${GATE} --test 'npm --prefix //host/share test'`,
    `${GATE} --test 'dotnet build -l:X,y.dll'`,
    `${GATE} --test 'dotnet build -logger:X,y.dll'`,
    `${GATE} --test 'dotnet build -rp:A=b'`,
    `${GATE} --test 'dotnet build @x.rsp'`,
    `${GATE} --test 'node scripts/Gate.mjs --lane-remove'`,
    `${GATE} --test 'node scripts/SWEEP.mjs'`,
    `${GATE} --test 'npm --prefix x test --prefix //host/share'`,
    `${GATE} --test 'npm --prefix x test --userconfig ../evil'`,
    `${GATE} --test 'dotnet build -l:"X y.dll"'`,
    `${GATE} --test 'dotnet build -l:X'`,
    `${GATE} --test 'dotnet build -bl:C:/x/y.binlog'`,
    `${GATE} --test 'dotnet build -fl -flp:logfile=C:/x/y.txt'`,
    `${GATE} --test 'dotnet build -pp:C:/x/y.txt'`,
    `${GATE} --test 'dotnet test -l:"X y.dll"'`,
    `${GATE} --test 'dotnet test -bl:C:/x/y.binlog'`,
    `${GATE} --test 'dotnet test -dfl -dflp:logfile=C:/x/y.txt'`,
    `${GATE} --test 'npm --prefix x test --prefi=../../y'`,
    `${GATE} --test 'npm --prefix x test --logs-dir=//host/share'`,
    `${GATE} --test 'npm --prefix x test --cache=../../evil'`,
    `${GATE} --test 'npm --prefix x test --watch=false'`,
    `${GATE} --test 'npm --prefix x test -- ../../y'`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const result = runTool(tool, command);

      // Then
      assert.equal(result.decision, 'ask', `${tool}: ${command}`);
    }
  }
});

test('given gate.mjs called with a --test or --unit value that is no plain test runner call, when the guard reads it, then it asks and names gate.mjs', () => {
  // Given
  const commands = [
    `${GATE} --test "git push --force"`,
    `${GATE} --test "npm test && rm -rf x"`,
    `${GATE} --red --unit "vitest; curl x" --test-files a.test.ts`,
    `${GATE} --test 'node --test --import "data:text/javascript;base64,AAAA"'`,
    `${GATE} --test 'node --test --require ./x.js'`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const result = runTool(tool, command);

      // Then
      assert.equal(result.decision, 'ask', `${tool}: ${command}`);
      assert.match(result.reason, /gate\.mjs.*Confirm\?$/, `${tool}: ${command}`);
    }
  }
});

test('given gate.mjs off Windows with sh quoting that hides a semicolon, when the guard reads it, then it asks', { skip: process.platform === 'win32' }, () => {
  // Given
  const command = `${GATE} --test 'npm test "\\"" ; touch pwned ; "\\""'`;

  // When
  const result = runTool('Bash', command);

  // Then
  assert.equal(result.decision, 'ask');
});

test('given a test command whose options run inline code, when the guard reads it, then it asks in both shells', () => {
  // Given
  const commands = [
    `${GATE} --test 'dotnet test -p:Foo=1'`,
    `${GATE} --test 'dotnet test /p:Foo=1'`,
    `${GATE} --test 'dotnet test -property:Foo=1'`,
    `${GATE} --test 'dotnet test /property:Foo=1'`,
    `${GATE} --test 'dotnet test -t:Foo'`,
    `${GATE} --test 'dotnet test /t:Foo'`,
    `${GATE} --test 'dotnet test -target:Foo'`,
    `${GATE} --test 'dotnet test -e DOTNET_STARTUP_HOOKS=x.dll'`,
    `${GATE} --test 'dotnet test --environment DOTNET_STARTUP_HOOKS=x.dll'`,
    `${GATE} --test 'npm test --script-shell calc.exe'`,
    `${GATE} --test 'pnpm test --node-options=--require=x.js'`,
    `${GATE} --test 'yarn test --node-options x'`,
  ];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const result = runTool(tool, command);

      // Then
      assert.equal(result.decision, 'ask', `${tool}: ${command}`);
    }
  }
});

test('given gate.mjs called with the hidden --supervise or --run flag, when the guard reads it, then it asks in both shells', () => {
  // Given
  const commands = [`${GATE} --supervise --run abc`, `${GATE} --test 'npm test' --run abc`, `${GATE} --supervise`];

  for (const command of commands) {
    for (const tool of BOTH) {
      // When
      const result = runTool(tool, command);

      // Then
      assert.equal(result.decision, 'ask', `${tool}: ${command}`);
    }
  }
});

test('given gate.mjs called with --lane-remove, when the guard reads it, then it asks in both shells and names the lost lane work', () => {
  // Given
  const command = `${GATE} --root . --lane-remove deliver-lane/a deliver-lane/b`;

  for (const tool of BOTH) {
    // When
    const result = runTool(tool, command);

    // Then
    assert.equal(result.decision, 'ask', tool);
    assert.match(result.reason, /--lane-remove/, tool);
  }
});

test('given a backslash inside double quotes under Bash, when the guard reads an allowed script call, then it asks', () => {
  // Given
  const commands = [
    String.raw`${GATE} --test "npm test x\" "\""&calc"`,
    String.raw`${PERIMETER} -Files "a\" "\""&calc"`,
    String.raw`${DB} -Env prod -Query "\"" ; calc # "`,
    String.raw`${PERIMETER} -Files "\"" ; calc # "`,
    String.raw`${DB} -Env prod -Query "\"" -AcceptWriteGrant # "`,
  ];

  for (const command of commands) {
    // When
    const result = runTool('Bash', command);

    // Then
    assert.equal(result.decision, 'ask', command);
  }
});

const SWEEP = 'node ~/.claude/scripts/sweep.mjs';

test('given sweep.mjs called with code in its arguments, when the guard reads it, then it denies with the re-quote hint and names sweep.mjs', () => {
  // Given
  const risky = [`${SWEEP} --root $(whoami) --since 2026-01-01T00:00:00Z`, `${SWEEP} --root (calc) --close`, `${SWEEP} --root "$env:TEMP" --close`];
  const plain = [`${SWEEP} --root . --since 2026-01-01T00:00:00Z --close`, `${SWEEP} --root 'C:\\wt\\repo' --since 2026-01-01T00:00:00Z`];

  for (const tool of BOTH) {
    // When
    const denied = risky.map((command) => runTool(tool, command));
    const approved = plain.map((command) => runTool(tool, command));

    // Then
    for (const result of denied) {
      assert.equal(result.decision, 'deny', tool);
      assert.match(result.reason, /arguments of sweep\.mjs.*single quote inside it\.$/, tool);
    }
    for (const result of approved) assert.equal(result.decision, 'approve', tool);
  }
});

test('settings.json allows the scope-guard --check call in both shells, and only that call', () => {
  const { allow } = JSON.parse(readFileSync(join(dirname(HOOK), '..', 'settings.json'), 'utf8')).permissions;
  for (const shell of ['Bash', 'PowerShell']) assert.ok(allow.includes(`${shell}(node ~/.claude/hooks/scope-guard.js --check *)`), shell);
  assert.deepEqual(allow.filter((r) => /scope-guard/.test(r) && !/scope-guard\.js --check \*\)$/.test(r)), []);
});

test('db-ro.ps1 -AcceptWriteGrant, in any abbreviation, asks; the other parameters do not', () => {
  for (const arg of ['-AcceptWriteGrant', '-acceptwritegrant', '-Accept', '-A', '-a', "'-AcceptWriteGrant'", '"-A"', '\u2013AcceptWriteGrant']) {
    for (const tool of BOTH) {
      const { decision, reason } = runTool(tool, `${DB} -Env prod -Query 'select 1' ${arg}`);
      assert.equal(decision, 'ask', `${tool}: ${arg}`);
      assert.match(reason, /Confirm\?$/, arg);
    }
  }
  assert.match(runTool('PowerShell', `${DB} -Env prod -A`).reason, /AcceptWriteGrant/);
});

test('settings.json blocks when guard-shell.js cannot run: onFailure block, no fail-open wrapper', () => {
  const settings = JSON.parse(readFileSync(join(dirname(HOOK), '..', 'settings.json'), 'utf8'));
  const hook = settings.hooks.PreToolUse
    .flatMap((g) => g.hooks ?? [])
    .find((h) => (h.args ?? []).join(' ').includes('guard-shell.js'));
  assert.equal(hook?.onFailure, 'block');
  assert.ok(!(hook.args ?? []).join(' ').includes('catch'));
});
