import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { evaluate } = createRequire(import.meta.url)('../hooks/lib/guard.js');
const decide = (tool_name, command, cwd = 'C:/repo') => evaluate({ tool_name, tool_input: { command }, cwd, session_id: 's1' })?.decision ?? 'pass';
// Built with join so this file carries no literal destructive command.
const BODY = ['rm', '-rf', 'C:/x/y'].join(' ');

test('given a PowerShell here-string written to a script, when a runner then runs it, then the guard asks', () => {
  // Given
  const commands = [
    `@'\n${BODY}\n'@ | Set-Content s.ps1; pwsh -File s.ps1`,
    `@'\n${BODY}\n'@ | Set-Content s.ps1\npwsh -File s.ps1`,
    `@'\n${BODY}\n'@ | Set-Content s.ps1; ./s.ps1`,
    `@"\n${BODY}\n"@ | iex`,
    `@'\n# don't stop here\n${BODY}\n'@ | Set-Content s.ps1; pwsh -File s.ps1`,
    `Set-Content s.ps1 @'\n${BODY}\n'@\npwsh s.ps1`,
  ];

  for (const command of commands) {
    // When
    const decision = decide('PowerShell', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a PowerShell here-string written to a data file, when nothing runs it, then the guard stays silent', () => {
  // Given
  const command = `@'\n${BODY}\n'@ | Set-Content notes.md`;

  // When
  const decision = decide('PowerShell', command);

  // Then
  assert.equal(decision, 'pass');
});

test('given a here-string assigned beside a command with a path argument, when the guard reads it, then its lines are not read as commands', () => {
  // Given: `./tests` has a slash, but dotnet runs no script the here-string wrote.
  const command = `$d = @'\n${BODY}\n'@\ndotnet test ./tests --logger $d`;

  // When
  const decision = decide('PowerShell', command);

  // Then
  assert.notEqual(decision, 'ask');
});

test('given a command launched by npm exec, npx, pnpm exec or a call string, when the guard reads it, then the nested command is checked', () => {
  // Given
  const commands = [
    `npm exec -- sh -c "${BODY}"`,
    `npx -y sh -c "${BODY}"`,
    `npm exec -c "${BODY}"`,
    `pnpm exec sh -c "${BODY}"`,
    `npm exec -- ${BODY}`,
    `npm x -- sh -c "${BODY}"`,
    `pnpx sh -c "${BODY}"`,
    `yarn dlx sh -c "${BODY}"`,
    `npm exec --call="${BODY}"`,
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a heredoc written to a Makefile or a git hook, when make or git follows, then the body is checked', () => {
  // Given
  const commands = [
    `cat > Makefile <<'EOF'\nall:\n\t${BODY}\nEOF\nmake`,
    `cat > .git/hooks/pre-commit <<'EOF'; git commit -m x\n${BODY}\nEOF`,
    `cat > .git/hooks/pre-commit <<'EOF'\n${BODY}\nEOF\ngit commit -m x`,
    `cat > ./.git/hooks/pre-push <<'EOF'\n${BODY}\nEOF\ngit push`,
    `cat > .husky/pre-commit <<'EOF'\n${BODY}\nEOF\ngit commit -m x`,
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a heredoc that is plain data, when a build tool, npm or git follows, then the guard stays silent', () => {
  // Given
  const commands = [
    `cat > notes.md <<'EOF'\n${BODY}\nEOF`,
    `git commit -F - <<'EOF'\n${BODY}\nEOF`,
    `node - <<'EOF'\n${BODY}\nEOF`,
    `cat > notes.md <<'EOF'\n${BODY}\nEOF\ndotnet build`,
    `cat > package.json <<'EOF'\n{}\nEOF\nnpm test`,
    'npx vitest run',
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.notEqual(decision, 'ask', command);
  }
});

test('given a Makefile written by a heredoc, when only git follows, then the guard stays silent', () => {
  // Given
  const commands = [
    `cat > Makefile <<'EOF'\nclean:\n\t${BODY}\nEOF\ngit status`,
    `cat > Makefile <<'EOF'\nclean:\n\t${BODY}\nEOF\ngit add Makefile && git commit -m x`,
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.notEqual(decision, 'ask', command);
  }
});

test('given a git hook written by a heredoc, when only make follows, then the guard stays silent', () => {
  // Given
  const command = `cat > .git/hooks/pre-commit <<'EOF'\n${BODY}\nEOF\nmake`;

  // When
  const decision = decide('Bash', command);

  // Then
  assert.notEqual(decision, 'ask');
});

test('given a package launcher behind leading options, when it runs a command, then the guard asks', () => {
  // Given
  const commands = [
    ['PowerShell', `pnpm --filter web exec ${BODY}`],
    ['Bash', `npm --prefix app exec -- ${BODY}`],
    ['Bash', `yarn workspace a exec ${BODY}`],
    ['Bash', `npm x -w a -- ${BODY}`],
  ];

  for (const [tool, command] of commands) {
    // When
    const decision = decide(tool, command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a package manager with options and no launcher verb, when it runs a script, then the guard stays silent', () => {
  // Given
  const command = 'pnpm --filter web test';

  // When
  const decision = decide('Bash', command);

  // Then
  assert.notEqual(decision, 'ask');
});

test('given a package manager with global options before exec, when it launches a command, then the guard asks', () => {
  // Given
  const commands = [
    `pnpm -r exec sh -c "${BODY}"`,
    `pnpm --filter web exec -- sh -c "${BODY}"`,
    `npm -w a exec -- sh -c "${BODY}"`,
    `pnpm --recursive exec ${BODY}`,
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a PowerShell here-string written to a git hook or a Makefile, when git or make follows, then the guard asks', () => {
  // Given
  const commands = [
    `Set-Content .git/hooks/pre-commit @'\n${BODY}\n'@\ngit commit -m x`,
    `@'\nall:\n\t${BODY}\n'@ | Set-Content Makefile; make`,
  ];

  for (const command of commands) {
    // When
    const decision = decide('PowerShell', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a PowerShell here-string written to a Makefile, when only git follows, then the guard stays silent', () => {
  // Given
  const command = `@'\nall:\n\t${BODY}\n'@ | Set-Content Makefile; git status`;

  // When
  const decision = decide('PowerShell', command);

  // Then
  assert.notEqual(decision, 'ask');
});

test('given a here-string written to a data file, when an everyday build command with a dot or a path follows, then the guard stays silent', () => {
  // Given
  const commands = [
    'dotnet build .',
    'dotnet build src/cmd',
    'docker build -t x .',
    'npx prettier --write .',
    'code .',
  ];

  for (const tail of commands) {
    const command = `$doc = @'\n${BODY}\n'@\n$doc | Set-Content notes.md\n${tail}`;

    // When
    const decision = decide('PowerShell', command);

    // Then
    assert.notEqual(decision, 'ask', command);
  }
});

test('given a launcher behind an npm value option, a .githooks hook or gmake, when the guard reads it, then it asks', () => {
  // Given
  const commands = [
    `npx --registry https://r.example sh -c "${BODY}"`,
    `npm --cache /tmp/c exec -- sh -c "${BODY}"`,
    `cat > .githooks/pre-commit <<'EOF'\n${BODY}\nEOF\ngit commit -m x`,
    `cat > Makefile <<'EOF'\nall:\n\t${BODY}\nEOF\ngmake`,
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a heredoc body with an apostrophe line fed to a shell, when the rm line follows it, then the guard asks', () => {
  // Given
  const commands = [
    `bash <<'EOF'\n# don't\n${BODY}\nEOF`,
    `sh -s <<'EOF'\n# don't\n${BODY}\nEOF`,
    `cat > s.sh <<'EOF'\n# don't\n${BODY}\nEOF\nbash s.sh`,
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a heredoc body with an apostrophe line fed to node or python, when the rm line follows it, then the guard does not ask', () => {
  // Given
  const commands = [
    `node - <<'EOF'\n// don't\n${BODY}\nEOF`,
    `python - <<'EOF'\n# don't\n${BODY}\nEOF`,
    `S=$(printf '%s' x); cat > /tmp/p2.js <<'EOF'\nconst t = "it's a string";\nconst cmds = [\n \`${BODY}\`,\n];\nconsole.log(cmds, t);\nEOF\nnode /tmp/p2.js`,
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.notEqual(decision, 'ask', command);
  }
});

test('given a heredoc body that npm exec runs, when the guard reads it, then it asks', () => {
  // Given
  const commands = [
    "npm exec bash <<'EOF'\nrm -rf /tmp/x/y\nEOF",
    "cat > f.sh <<'EOF'\nrm -rf /x/y\nEOF\nnpm exec -- ./f.sh",
    "cat > f.sh <<'EOF'\nrm -rf /x/y\nEOF\nnpm run x -- ./f.sh",
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a PowerShell here-string written to a script, when a runner follows, then the guard asks', () => {
  // Given
  const commands = [
    "Set-Content f.ps1 @'\nRemove-Item -Recurse C:/x/y\n'@\npwsh f.ps1",
    "Set-Content f.ps1 @'\nRemove-Item -Recurse C:/x/y\n'@\n./f.ps1",
  ];

  for (const command of commands) {
    // When
    const decision = decide('PowerShell', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a heredoc fed to a shell through npm exec or explore, when the guard reads it, then it asks', () => {
  // Given
  const commands = [
    "npm exec -- bash <<'EOF'\nrm -rf ~/x\nEOF",
    "npm exec bash <<'EOF'\nrm -rf ~/x\nEOF",
    "npm explore lodash -- sh <<'EOF'\nrm -rf ~/x\nEOF",
  ];

  for (const command of commands) {
    // When
    const decision = decide('Bash', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

test('given a here-string piped to Set-Content and then run, when the guard reads it, then it asks', () => {
  // Given
  const command = "@'\nRemove-Item -Recurse -Force C:/repo/src\n'@ | Set-Content s.ps1; pwsh -File s.ps1";

  // When
  const decision = decide('PowerShell', command);

  // Then
  assert.equal(decision, 'ask');
});

test('given a shell heredoc and a node stdin heredoc on one line, when the node body has an apostrophe and a delete, then the guard stays silent', () => {
  // Given
  const command = `bash <<'EOF'\necho hi\nEOF\nnode - <<'EOF2'\n// don't\n${BODY}\nEOF2`;
  // When
  const decision = decide('Bash', command);
  // Then
  assert.equal(decision, 'pass');
});
