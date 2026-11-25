// Tests for hooks/guard-shell.js: recursive deletes, heredoc bodies and here-strings. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SHA, created, runRaw, run, onFeature, runShell, asks, approves } from './guard-shell-shared.test.mjs';

const TMP = tmpdir().replace(/\\/g, '/');
const THROWAWAY = `${TMP}/claude/proj/session`;

test('given a recursive delete aimed only at a Claude temp folder below the session folder, when the guard reads it, then it approves', () => {
  // Given
  const commands = [
    `rm -rf ${THROWAWAY}/x`, `rm -rf -- ${THROWAWAY}/x ${THROWAWAY}/y/z`, `rm -rf '${THROWAWAY}/x'`, `rd /s /q ${THROWAWAY}/x`,
    `rd /s /q ${THROWAWAY.replace(/\//g, '\\')}\\x`,
    `Remove-Item -Recurse -Force ${THROWAWAY}/x`, `ri -r -fo '${THROWAWAY}/x'`, `Remove-Item -Path ${THROWAWAY}/a,${THROWAWAY}/b -Recurse`,
  ];

  for (const command of commands) {
    // When
    const { decision } = runShell(command);

    // Then
    assert.equal(decision, 'approve', command);
  }
});

test('given a recursive delete that is not clearly inside a Claude temp session folder, when the guard reads it, then it asks', () => {
  // Given
  const commands = [
    `rm -rf ${TMP}/claude`, `rm -rf ${TMP}/claude/proj`, `rm -rf ${THROWAWAY}`, `rm -rf ${THROWAWAY}/../other`, `rm -rf ${THROWAWAY}/x/..`,
    'rm -rf claude/proj/session/x', 'rd /s /q %TEMP%\\claude\\proj\\session\\x',
    `rm -rf ${THROWAWAY}/*`, `rm -rf ${THROWAWAY}/x /etc`, `rm -rf ${THROWAWAY}/a/b/c /etc`,
    `Remove-Item -Recurse -Path ${THROWAWAY}/a,/etc`, `rm -rf ${THROWAWAY}/{a,b}`, `rm -rf ${THROWAWAY}/$(whoami)`,
    `rm -rf ${THROWAWAY}/x --no-preserve-root`, `sudo rm -rf ${THROWAWAY}/x`, `ls | xargs rm -rf ${THROWAWAY}/x`, 'rm -rf ~/claude/proj/session/x',
    `rm -r ${THROWAWAY}/x,src`, `rm -r ${THROWAWAY}/x,/Users`, `Remove-Item -Recurse ${THROWAWAY}/x,src`,
    `cmd /c rd /s /q ${THROWAWAY}/x,src`, `rd /s /q ${THROWAWAY}/x,src`, `rd /s /q ${THROWAWAY}/x=src`, `erase /s /q ${THROWAWAY}/x,src`,
    `ln -s /home/me/proj ${THROWAWAY}/l && rm -rf ${THROWAWAY}/l/src`, `mklink /J ${THROWAWAY}\\l C:\\proj && rd /s /q ${THROWAWAY}\\l\\src`,
    `New-Item -ItemType Junction -Path ${THROWAWAY}/l -Target C:/proj; Remove-Item -Recurse -Force ${THROWAWAY}/l/src`,
    `python3 mklinks.py; rm -rf ${THROWAWAY}/l/src`, `rm -rf ${THROWAWAY}/d && cp -r /tmp/t ${THROWAWAY}/d && rm -rf ${THROWAWAY}/d/x`,
    `rm -rf ${THROWAWAY}\\x`, `rd /s /q ${THROWAWAY.replace(/\//g, '\\')}\\..\\x`,
    'rm -rf //server/share/claude/proj/session/x', 'rd /s /q \\\\server\\share\\claude\\proj\\session\\x',
    `rd /s /q \\\\?\\${THROWAWAY.replace(/\//g, '\\')}\\x`,
  ];

  for (const command of commands) {
    // When / Then
    asks(command, /recursively or by force|previous command/);
  }
});

test('given a recursive delete whose operand is a link inside a Claude temp folder, when the guard reads it, then it asks', (t) => {
  // Given
  const outside = mkdtempSync(join(tmpdir(), 'guard-outside-'));
  const project = join(tmpdir(), 'claude', 'linkproj');
  created.push(outside, project);
  mkdirSync(join(project, 'linksession'), { recursive: true });
  const link = join(project, 'linksession', 'link');
  try { symlinkSync(outside, link, 'junction'); } catch (error) {
    if (process.platform === 'win32') throw error; // a junction needs no privilege on Windows: never skip silently there
    t.skip('cannot create a link here'); return;
  }
  const linked = link.replace(/\\/g, '/');

  // When / Then
  asks(`rm -rf ${linked}`, /recursively or by force/);
  asks(`rm -rf ${linked}/inner`, /recursively or by force/);
});

test('given a real session folder with a real child, when this session deletes the child, then it approves; another session id asks', () => {
  // Given
  const project = join(tmpdir(), 'claude', 'realproj');
  created.push(project);
  const child = join(project, 'sess-a', 'child');
  mkdirSync(join(child, 'inner'), { recursive: true });
  writeFileSync(join(child, 'inner', 'f.txt'), 'x');
  const target = child.replace(/\\/g, '/');
  const withSession = (command, session_id) => runRaw(JSON.stringify({ tool_input: { command }, cwd: onFeature, session_id }));

  // When / Then
  assert.equal(withSession(`rm -rf ${target}`, 'sess-a').decision, 'approve');
  assert.equal(withSession(`rd /s /q ${target}`, 'sess-a').decision, 'approve');
  assert.equal(withSession(`rm -rf ${target}`, 'sess-b').decision, 'ask');
  assert.equal(existsSync(child), true);
});

test('given the Windows 8.3 short form of a temp folder, when a delete targets it, then only the payload session folder passes', { skip: process.platform !== 'win32' }, () => {
  // Given
  const short = ['C:', 'Users', 'SOMEON~1', 'AppData', 'Local', 'Temp', 'claude', 'proj'].join('/');
  const withSession = (command, session_id) => runRaw(JSON.stringify({ tool_input: { command }, cwd: onFeature, session_id }));

  // When / Then
  assert.equal(withSession(`rm -rf ${short}/sess-a/x`, 'sess-a').decision, 'approve');
  assert.equal(withSession(`rm -rf ${short}/sess-b/x`, 'sess-a').decision, 'ask');
});

// Every spelling of this machine's temp folder: long profile name, os.tmpdir()'s own (maybe 8.3), drive form and MSYS form.
const spellings = () => {
  const long = realpathSync.native(tmpdir()).replace(/\\/g, '/');
  const own = tmpdir().replace(/\\/g, '/');
  const msys = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  return [...new Set([long, own, msys(long), msys(own)])];
};

test('given a recursive delete below the session folder written in any spelling of the temp folder, when the guard reads it, then it approves', { skip: process.platform !== 'win32' }, () => {
  for (const root of spellings()) {
    // Given
    const dir = `${root}/claude/proj/session`;
    const commands = [`rm -rf "${dir}/x"`, `rm -rf '${dir}/x'`, `S="${dir}"; rm -rf "$S/x"`, `S='${dir}'\nrm -rf "$S/x"`];

    for (const command of commands) {
      // When
      const { decision } = runRaw(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: onFeature }));

      // Then
      assert.equal(decision, 'approve', command);
    }
  }
});

test('given a recursive delete that is not strictly below a session folder, or a plain path, in any spelling, when the guard reads it, then it asks', { skip: process.platform !== 'win32' }, () => {
  for (const root of spellings()) {
    // Given
    const dir = `${root}/claude/proj/session`;
    const commands = [
      `rm -rf "${root}/claude/proj"`, `rm -rf "${dir}"`, `rm -rf "${dir}/../x"`, `rm -rf "${dir}/x/.."`, `rm -rf "${dir}/*"`,
      `rm -rf "${root}/other"`, `rm -rf "${root}/other/claude/proj/session/x"`, `S="${root}/claude/proj"; rm -rf "$S"`,
      `S="${dir}"; rm -rf "$S/../x"`, `rm -rf "${dir}/$(whoami)"`,
    ];

    for (const command of commands) {
      // When / Then
      asks(command, /recursively or by force|previous command/);
    }
  }
});

test('given a heredoc whose receiver is not a shell, when its body holds a destructive text, then the guard approves', () => {
  // Given
  const bodies = ['rm -rf /', 'docker compose down -v', 'git push --delete origin main'];
  const heads = ['cat > f.js', 'cat >> f.txt', 'node -', 'python -', 'python3 -', 'tee out.txt', 'deno run -', 'ruby -', 'perl -'];

  for (const head of heads) for (const body of bodies) {
    const command = `${head} <<'EOF'\n${body}\nEOF`;

    // When
    const { decision } = runShell(command);

    // Then
    assert.equal(decision, 'approve', command);
  }
});

test('given a heredoc whose receiver is a shell, when its body holds rm -rf /, then the guard still asks', () => {
  // Given
  const heads = ['bash', 'sh -s', 'pwsh -Command -', 'ssh host', 'docker exec -i c sh', 'zsh', 'bash -s --'];

  for (const head of heads) {
    const command = `${head} <<'EOF'\nrm -rf /\nEOF`;

    // When / Then
    asks(command, /recursively or by force/);
  }
});

test('given a script written by heredoc without a suffix, when a prefix command runs it, then the guard still asks', () => {
  // Given
  const runs = ['timeout 60 ./s', 'stdbuf -o0 ./s', 'watch ./s', 'watch s', 'nice ./s', 'setsid ./s', 'flock l ./s', 'strace ./s', 'doas ./s'];

  for (const run of runs) {
    const command = `cat > s <<'EOF'\nrm -rf /\nEOF\n${run}`;

    // When / Then
    asks(command, /recursively or by force/);
  }
});

test('given a database client heredoc, when its body holds a destructive statement, then the guard still asks', () => {
  // Given
  const commands = [
    `psql <<'SQL'\nDROP TABLE x;\nSQL`,
    `sqlcmd -S s <<'SQL'\nTRUNCATE TABLE x;\nSQL`,
    `mysql db <<'SQL'\nDROP DATABASE x;\nSQL`,
    `sqlite3 f.db <<'SQL'\nDROP TABLE x;\nSQL`,
    `redis-cli <<'R'\nFLUSHALL\nR`,
    `mongosh <<'J'\ndb.dropDatabase()\nJ`,
    `cqlsh <<'C'\nTRUNCATE t;\nC`,
  ];

  for (const command of commands) {
    // When
    const { decision } = runShell(command);

    // Then
    assert.notEqual(decision, 'approve', command);
  }
});

test('given a destructive opening line with a heredoc, when the guard reads it, then it still asks', () => {
  // Given
  const commands = [`cat <<EOF | sh\nrm -rf /\nEOF`, `rm -rf x <<EOF\nhello\nEOF`, `cat <<'EOF' | bash\nrm -rf /\nEOF`];

  for (const command of commands) {
    // When / Then
    asks(command, /recursively or by force/);
  }
});

test('given a body that may run as a command, when the guard reads the line, then it still asks', () => {
  // Given
  const commands = [
    `timeout 60 bash <<'EOF'\nrm -rf /\nEOF`, `sudo -s <<'EOF'\nrm -rf /\nEOF`, `(bash <<'EOF'\nrm -rf /\nEOF\n)`,
    `{ cat <<'EOF'\nrm -rf /\nEOF\n} | bash`, `cat <<EOF\n$(rm -rf /)\nEOF`, `cat <<EOF\n\`rm -rf /\`\nEOF`,
    `echo $((1 << n))\nrm -rf src`, `cat <<'EOF.md' > notes.md\ntext\nEOF.md\nrm -rf src`,
    `psql <<'SQL'\nDROP TABLE x;\nSQL`, `sqlcmd <<'SQL'\nTRUNCATE TABLE x;\nSQL`, `mysql <<'SQL'\nDROP TABLE x;\nSQL`,
    `sqlite3 db <<'SQL'\nDROP TABLE x;\nSQL`, `redis-cli <<'R'\nFLUSHALL\nR`, `mongosh <<'J'\ndb.dropDatabase()\nJ`,
    `cqlsh <<'C'\nDROP TABLE x;\nC`,
  ];

  for (const command of commands) {
    // When / Then
    const { decision } = runShell(command);
    assert.equal(decision, 'ask', command);
  }
});

test('given a body fed through process substitution, a trailing pipe or a script it wrote, when the guard reads the line, then it still asks', () => {
  // Given
  const commands = [
    `cat <<'EOF' > >(bash)\nrm -rf /\nEOF`, `tee >(sh) <<'EOF'\nrm -rf /\nEOF`, `cat <<'EOF' |\nrm -rf /\nEOF\nsh`,
    `cat > s.sh <<'EOF'\nrm -rf /\nEOF\nbash s.sh`, `cat > s.sh <<'EOF'\nrm -rf /\nEOF; bash s.sh`, `cat <<'EOF' \\\nrm -rf /\nEOF`,
    `cat > s.sh <<'EOF'\nrm -rf /\nEOF\nchmod +x s.sh && ./s.sh`, `cat > s.sh <<'EOF'\nrm -rf /\nEOF\ntimeout 60 bash s.sh`,
    `cat > s.sh <<'EOF'\nrm -rf /\nEOF\nash s.sh`, `cat > s.sh <<'EOF'\nrm -rf /\nEOF\nfish s.sh`,
    `cat > s.sh <<'EOF'\nrm -rf /\nEOF\nbusybox ash s.sh`, `cat > s.sh <<'EOF'\nrm -rf /\nEOF\nwatch s.sh`,
    `cat > s.sh <<'EOF'\nrm -rf /\nEOF\nstdbuf -o0 s.sh`,
    `cat > s.sh <<'EOF'\nrm -rf /\nEOF\nnice sh s.sh`, `cat > s.sh <<'EOF'\nrm -rf /\nEOF\n"$SHELL" s.sh`,
  ];

  for (const command of commands) {
    // When / Then
    asks(command, /recursively or by force/);
  }
});

test('given a data receiver with a dangerous body and no runner anywhere, when the guard reads it, then it approves', () => {
  // Given
  const commands = [`cat > f <<'EOF'\nrm -rf /\nEOF`, `node - <<'EOF'\nrm -rf /\nEOF`, `python - <<'EOF'\nrm -rf /\nEOF`];

  for (const command of commands) {
    // When
    const { decision } = runShell(command);

    // Then
    assert.equal(decision, 'approve', command);
  }
});

test('given a PowerShell /c/ temp path, when the guard reads a recursive delete, then it asks', { skip: process.platform !== 'win32' }, () => {
  // Given
  const root = spellings().find((s) => s.startsWith('/c/'));
  const command = `Remove-Item -Recurse -Force ${root}/claude/proj/session/x`;

  // When
  const { decision } = asTool('PowerShell', command);

  // Then
  assert.equal(decision, 'ask', command);
});

test('given PowerShell here-strings, when a command follows a closer or the text expands, then the guard still asks', () => {
  // Given
  const commands = [
    `$s = @'\ntext\n'@; Remove-Item -Recurse -Force C:\\repo\\src`, `$s = @'\ntext\n'@ | Invoke-Expression; Remove-Item -Recurse -Force C:\\repo\\src`,
    `$s = @"\n$(Remove-Item -Recurse -Force C:\\repo\\src)\n"@`,
    `$a = @'\none\n'@\n$b = @'\ntwo\n'@; Remove-Item -Recurse -Force C:\\repo\\src`,
  ];

  for (const command of commands) {
    // When
    const { decision } = asTool('PowerShell', command);

    // Then
    assert.equal(decision, 'ask', command);
  }
});

const asTool = (tool_name, command) => runRaw(JSON.stringify({ tool_name, tool_input: { command }, cwd: onFeature }));

/** A real `<tmp>/claude/cdproj/cdsess/scratchpad/ui-tests` folder: a `cd` into it only counts when it exists. */
function makeTempSession() {
  const project = join(tmpdir(), 'claude', 'cdproj');
  created.push(project);
  const session = `${TMP}/claude/cdproj/cdsess`;
  mkdirSync(join(project, 'cdsess', 'scratchpad', 'ui-tests', 'holder'), { recursive: true });
  return { session, dir: `${session}/scratchpad/ui-tests` };
}

test('given a delete with relative operands after a cd into the Claude temp session folder, when the guard reads it, then it approves', () => {
  // Given
  const { session, dir } = makeTempSession();
  const winDir = dir.replace(/\//g, '\\');
  const lines = [
    ['Bash', `cd "${dir}"; rm -f results.jsonl; python s1.py`], ['Bash', `cd ${dir} && rm -rf out`], ['Bash', `cd ${session}; cd scratchpad/ui-tests; rm -rf out`],
    ['Bash', `pushd ${dir}; rm -rf ./out`], ['Bash', `cd ${dir}; rm -rf '${dir}/out' ./b`], [undefined, `cd ${dir}; rm -rf holder`],
    ['PowerShell', `Set-Location ${dir}; Remove-Item -Recurse -Force x`], ['PowerShell', `Set-Location ${winDir}; Remove-Item -Recurse -Force x`],
    ['PowerShell', `Set-Location -Path "${dir}"; Remove-Item -Recurse -Force x`], ['PowerShell', `sl ${dir}; Remove-Item -Recurse -Force x`],
    ['Bash', `rm -rf ${dir}/holder/a && cd ${dir}/holder && rm -rf proj`],
  ];

  for (const [tool, command] of lines) {
    // When
    const { decision } = asTool(tool, command);

    // Then
    assert.equal(decision, 'approve', `${tool}: ${command}`);
  }
});

test('given a variable the shell really assigned a literal Claude temp path, when a cd or delete uses it, then it approves', () => {
  // Given
  const { dir } = makeTempSession();
  const lines = [
    ['Bash', `SP="${dir}"; cd $SP; rm -rf out`], ['Bash', `SP=${dir}; cd "$SP" && rm -rf a b/c`], ['Bash', `SP='${dir}'; rm -rf $SP/out`],
    ['PowerShell', `$SP = "${dir}"; Set-Location $SP; Remove-Item -Recurse -Force x`],
    ['PowerShell', `$sp='${dir}'; Set-Location $SP; Remove-Item -Recurse -Force x`],
  ];
  if (process.platform === 'win32') {
    lines.push(
      ['Bash', 'rm -rf $TEMP/claude/cdproj/cdsess/x'], ['Bash', 'cd ${TEMP}/claude/cdproj/cdsess; rm -rf x'],
      ['PowerShell', 'Remove-Item -Recurse -Force $env:TEMP\\claude\\cdproj\\cdsess\\x'],
      ['PowerShell', 'Set-Location $env:TEMP/claude/cdproj/cdsess/scratchpad; Remove-Item -Recurse -Force ui-tests/out'],
    );
  }

  for (const [tool, command] of lines) {
    // When
    const { decision } = asTool(tool, command);

    // Then
    assert.equal(decision, 'approve', `${tool}: ${command}`);
  }
});

test('given a variable or cd the shell would not set, or a delete reordered by the line, when the guard reads it, then it asks', () => {
  // Given
  const { dir } = makeTempSession();
  const lines = [
    ['Bash', `$x=${dir}; rm -rf $x/etc`], ['Bash', `x = ${dir}; rm -rf $x/etc`],
    ['PowerShell', `x=${dir}; Remove-Item -Recurse $x/etc`], ['PowerShell', `$x = ${dir}; Remove-Item -Recurse $x/etc`],
    ['PowerShell', `$p='${dir}'; $P='C:/Windows'; Set-Location $p; Remove-Item -Recurse sub`],
    ['Bash', `SP=${dir}; cd '$SP'; rm -rf out`], ['Bash', `SP=$(pwd); rm -rf $SP/out`], ['Bash', `SP=${dir}/a b; rm -rf $SP/out`],
    [undefined, `SP=${dir}; cd $SP; rm -rf out`], [undefined, `$SP = "${dir}"; Set-Location $SP; Remove-Item -Recurse -Force x`],
    ['Bash', `cd ${dir} & rm -rf proj`], ['Bash', `cd ${dir} || rm -rf proj`], ['Bash', `cd ${dir} | rm -rf proj`],
    ['PowerShell', `Set-Location ${dir} & Remove-Item -Recurse proj`], ['Bash', `rm -rf proj || cd ${dir}; rm -rf proj`],
    ['Bash', `rm -rf proj;cd ${dir};rm -rf proj`], ['Bash', `rm -rf proj; cd ${dir}; rm -rf proj`],
    ['PowerShell', 'Remove-Item -Recurse $TEMP/claude/cdproj/cdsess/x'], ['PowerShell', 'Remove-Item -Recurse $env:TEMP/claude/cdproj/cdsess/x /etc'],
    ['Bash', 'rm -rf $env:TEMP/claude/cdproj/cdsess/x'], [undefined, 'rm -rf $TEMP/claude/cdproj/cdsess/x'],
    ['PowerShell', '$TEMP = "C:/"; Remove-Item -Recurse $TEMP/claude/cdproj/cdsess/x'],
    // A delete that removes the cd target (or fails and skips the cd): the cd fails and `;` deletes in the real folder.
    ['Bash', `rm -rf ${dir}; cd ${dir}; rm -rf proj`], ['Bash', `rm -rf ${dir}/holder && cd ${dir}/holder; rm -rf proj`],
    ['PowerShell', `Remove-Item -Recurse ${dir}/holder; Set-Location ${dir}/holder; Remove-Item -Recurse proj`],
    // A cd spelling the running shell does not know fails, and `;` runs the delete anyway.
    ['Bash', `chdir ${dir}; rm -rf proj`], ['Bash', `Set-Location ${dir}; rm -rf proj`], ['Bash', `sl ${dir}; rm -rf proj`],
    ['Bash', `cd -Path ${dir}; rm -rf proj`], ['Bash', `pushd -Path ${dir}; rm -rf proj`], [undefined, `pushd ${dir}; rm -rf proj`],
    // Variables that change word splitting, cd lookup or command lookup.
    ['Bash', `IFS=/; SP=${dir}/src; rm -rf $SP`], ['Bash', `CDPATH=/; cd ${dir}; rm -rf x`], ['Bash', `PATH=${dir}; cd ${dir}; rm -rf x`],
    ['PowerShell', `$IFS = '${dir}'; Set-Location $IFS; Remove-Item -Recurse x`],
  ];

  for (const [tool, command] of lines) {
    // When
    const { decision } = asTool(tool, command);

    // Then
    assert.equal(decision, 'ask', `${tool}: ${command}`);
  }
});

test('given a delete whose folder is not provably inside the Claude temp session folder, when the guard reads it, then it asks', () => {
  // Given
  const { session, dir } = makeTempSession();
  const commands = [
    'rm -rf out', `cd ${dir}; cd ..; rm -rf out`, `cd ${dir}; cd -; rm -rf out`, `cd ${dir}; cd /; rm -rf out`, `cd ${dir}; cd; rm -rf out`,
    `cd ${dir}; rm -rf ../out`, `cd ${dir}; rm -rf ../../..`, `cd ${dir}; rm -rf .`, `cd ${session}; rm -rf .`,
    `cd ${TMP}/claude; rm -rf proj`, `cd ${TMP}/claude/cdproj; rm -rf cdsess`, `cd ${dir}/missing; rm -rf out`,
    `cd $SP; rm -rf out`, `SP=/etc; cd $SP; rm -rf out`, `SP=$(pwd); cd $SP; rm -rf out`, `SP="${dir}"; SP=/etc; cd $SP; rm -rf out`,
    `cd ${dir}; rm -rf /`, `cd ${dir}; rm -rf ~`, `cd ${dir}; rm -rf out /etc`, `cd ${dir}; python s1.py; rm -rf out`,
    `Set-Location ${dir}; Set-Location ..; Remove-Item -Recurse -Force x`, `Set-Location ${dir}; Remove-Item -Recurse -Force ..\\x`,
    `cd ${dir}; ln -s /etc l; rm -rf l/x`, `bash -c "cd ${dir}; rm -rf out"`,
  ];

  for (const command of commands) {
    // When / Then
    asks(command, /recursively or by force|previous command/);
  }
});

test('given a junction inside the tree a PowerShell delete would recurse into, when the guard reads it, then Remove-Item asks, and so does rm on Windows', (t) => {
  // Given
  const { dir } = makeTempSession();
  const outside = mkdtempSync(join(tmpdir(), 'guard-outside-'));
  created.push(outside);
  try { symlinkSync(outside, join(dir, 'holder', 'jx'), 'junction'); } catch (error) {
    if (process.platform === 'win32') throw error;
    t.skip('cannot create a link here'); return;
  }

  // When / Then
  asks(`Set-Location ${dir}; Remove-Item -Recurse -Force holder`, /recursively or by force/);
  assert.equal(runShell(`cd ${dir}; rm -rf holder`).decision, process.platform === 'win32' ? 'ask' : 'approve'); // there `rm` is a Remove-Item alias
  asks(`cd ${dir}; del -Recurse holder`, /recursively or by force/);
});

test('git switch that discards local changes asks', () => {
  for (const command of ['git switch -f main', 'git switch --force main', 'git switch --discard-changes main', 'git switch -fc fix/x']) {
    asks(command, /discards local changes/);
  }
  for (const command of ['git switch main', 'git switch -c feature/x', 'git switch --create fix-feature', 'git switch -']) approves(command);
});

test('find that deletes asks, a plain find does not', () => {
  for (const command of [
    'find . -name "*.log" -delete', 'find ./bin -type f -delete', 'find . -name x -exec rm {} ;', 'find . -name x -exec rm -f {} +',
    'find . -name x -execdir rm {} +', 'find . -exec /bin/rm {} +', 'find / -exec /bin/rm -f {} ;',
  ]) asks(command, /find deletes/);
  for (const command of ['find . -name x', 'find . -name "*.log" -print', 'find . -name x -exec grep -l foo {} +', 'find . -name "delete-me*"']) approves(command);
});

test('given a git checkout or restore that discards working-tree changes, when the guard reads it, then it lets it through (the owner\'s night-work choice)', () => {
  // Given / When / Then
  for (const command of [
    'git checkout -- src/a.cs', 'git checkout -- .', 'git checkout .', 'git checkout HEAD~1 -- a.cs', 'git checkout -f main', 'git checkout -fb x',
    'git restore a.cs', 'git restore .', 'git restore --worktree a.cs', 'git restore --staged --worktree a.cs', 'git restore -SW a.cs',
    'git restore --source=HEAD~1 a.cs', 'git -C repo restore a.cs',
    'git checkout -b feature/x', 'git checkout main', 'git checkout feature/x', 'git checkout -B fix/y origin/main', 'git checkout -b x',
    'git restore --staged a.cs', 'git restore -S a.cs', 'git restore --staged .', 'git restore --help',
    'git commit -m "restore the old layout"', 'git log --oneline -- a.cs',
  ]) approves(command);
});

test('git clean asks when it forces, not on a dry run', () => {
  for (const command of ['git clean -fd', 'git clean -dfx', 'git clean --force -d']) asks(command, /untracked files/);
  for (const command of ['git clean -n', 'git clean -fdn', 'git clean --dry-run -d', 'git clean -d']) approves(command);
});

test('a pipeline ending in a deleter asks, even without -Recurse', () => {
  for (const command of [
    'Get-ChildItem *.log | Remove-Item', 'Get-ChildItem *.log | rm', 'gci *.log | del', 'Get-ChildItem *.log | ri', 'git ls-files -o | xargs rm',
    'ls | foreach { Remove-Item $_.FullName }', 'gci | ForEach-Object { ri $_ }', 'ls | % { rm $_ }',
  ]) asks(command, /previous command of the pipeline/);
  for (const command of [
    'Get-ChildItem *.log | Remove-Item -WhatIf', 'Get-ChildItem *.log | Select-Object Name', 'ls | % { $_.Name }', 'Remove-Item a.log', 'a || rm a.log',
  ]) approves(command);
});
