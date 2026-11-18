// Tests for hooks/guard-shell.js: shell wrappers, git verbs, agents and browser-use. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createRequire } from 'node:module';
import { evaluate, HOOK, created, runRaw, spawnRaw, run, onDefault, onFeature, runShell, asks, approves } from './guard-shell-shared.test.mjs';

test('a destructive command wrapped in a shell, a container exec or ssh still asks', () => {
  asks('bash -c "git push --force origin main"', /deletes or force-overwrites a remote ref/);
  asks("sh -c 'git push --force origin feature/x'", /remote ref/);
  asks('docker exec db sh -c "rm -rf /data"', /deletes files recursively/);
  asks('pwsh -c "Remove-Item -Recurse -Force x"', /deletes files recursively/);
  asks('powershell -Command "Remove-Item -Recurse x"');
  asks('cmd /c rd /s /q x');
  asks('ssh host "rm -rf /var/app"');
  asks('ssh -p 2222 -i key host rm -rf /var/app');
  asks('sudo bash -c "git clean -fd"');
  asks('bash -c "echo $(rm -rf x)"');
  asks('echo `rm -rf x`');
});

test('a wrapped push to the default branch asks from a working branch, and from the default branch', () => {
  assert.match(run('bash -c "git push origin main"', onFeature).reason, /pushes to 'main'/);
  assert.match(run('docker exec ci sh -c "git push origin main"', onFeature).reason, /pushes to 'main'/);
  assert.match(run('ssh host "git push origin main"', onFeature).reason, /pushes to 'main'/);
  assert.match(run('pwsh -c "git commit -m wip"', onDefault).reason, /default branch/);
  assert.equal(run('bash -c "git push origin feature/x"', onFeature).decision, 'approve');
});

test('`--` is a SQL comment only for a SQL client: a flag inside any other quoted span still counts', () => {
  asks('bash -c "git push --force origin main"');
  approves('sqlcmd -S localhost -Q "SELECT 1 -- DROP TABLE x"');
  asks('sqlcmd -S localhost -Q "SELECT 1; DROP TABLE x -- tidy"');
});

test('a searcher with a substitution is not skipped', () => {
  asks('grep foo $(rm -rf x)', /deletes files recursively/);
  asks('grep foo `rm -rf x`');
  asks('rg x <(rm -rf y)');
  approves('grep -rn "rm -rf" .');
  approves("grep -rn '$(rm -rf x)' .");
});

test('given a recursive delete inside an if, a loop or a braced group, when the guard reads it, then it asks', () => {
  // Given
  const commands = [
    'if true; then rm -rf /etc; fi', 'for i in 1; do rm -rf /etc; done', 'true && { rm -rf /etc; }',
    'while false; do :; done; if ! rm -rf /etc; then echo x; fi', 'if true; then :; else sudo rm -rf /etc; fi',
  ];

  for (const command of commands) {
    // When
    const { decision } = runShell(command);

    // Then
    assert.equal(decision, 'ask', command);
  }
  approves('if true; then echo ok; fi');
});

test('git reset --hard asks with options before the verb', () => {
  asks('git reset --hard', /hard reset/);
  asks('git -C . reset --hard HEAD~3', /hard reset/);
  asks('git -c x=1 reset --hard');
  asks('git --no-pager reset --hard origin/main');
  asks('git --git-dir /x reset --hard', /hard reset/);
  asks('git --work-tree /x clean -fd');
  asks('git --git-dir /x --work-tree /y branch -f main HEAD~2', /branch/);
  approves('git --git-dir /x reset --soft HEAD~1');
  approves('git reset --soft HEAD~1');
  approves('git reset HEAD file.txt');
  approves('git -C . reset --mixed HEAD~1');
});

test('git branch asks when it moves or renames a branch, and not when it lists', () => {
  for (const command of [
    'git branch -f foo HEAD~2', 'git branch -m old new', 'git branch -M old new', 'git branch --force foo', 'git branch --move a b',
    'git branch -C main topic', 'git branch --copy a b',
  ]) asks(command, /branch/);
  for (const command of ['git branch', 'git branch -vv', 'git branch -a', 'git branch --sort=-committerdate', 'git branch --show-current', 'git branch --list "fe*"', 'git branch feature/new']) {
    approves(command);
  }
});

test('update-ref -d, filter-branch and gc --prune=now ask', () => {
  asks('git update-ref -d refs/heads/x', /deletes a ref/);
  asks('git update-ref --delete refs/heads/x');
  asks('git filter-branch --tree-filter "rm f" HEAD');
  asks('git gc --prune=now');
  asks('git -C repo gc --prune=all');
  approves('git update-ref refs/heads/x HEAD');
  approves('git gc');
  approves('git gc --auto');
});

test('gh deletes ask, whatever the object, and so does a DELETE through gh api', () => {
  for (const command of [
    'gh issue delete 5', 'gh variable delete X', 'gh label delete bug', 'gh repo delete a/b --yes',
    'gh api -X DELETE /repos/a/b', 'gh api repos/a/b --method DELETE', 'gh api -XDELETE /repos/a/b/issues/1', 'gh api --method=DELETE /x',
  ]) asks(command, /remote host/);
  approves('gh api repos/a/b');
  approves('gh issue list');
});

test('docker rm / rmi that force or take volumes ask', () => {
  for (const command of ['docker rm -f c1', 'docker rm -v c1', 'docker rm -fv c1', 'docker container rm -f c1', 'docker rmi -f img', 'docker image rm --force img', 'docker rm --volumes c1']) {
    asks(command, /container or image/);
  }
  for (const command of ['docker rm c1', 'docker rmi img', 'docker run --rm -v a:/b img', 'docker ps -a']) approves(command);
});

test('a danger word in a title, a body, a message or an echo is inert', () => {
  for (const command of [
    'echo "git clean -fd"',
    'Write-Output "rm -rf /"',
    "printf 'DROP TABLE x\n'",
    'az boards work-item create --title "Delete user flow" --assigned-to me --type Task',
    'az repos pr create --title "Delete obsolete" --delete-source-branch true --squash true --work-items 1',
    'git commit -m "feat: drop table support"',
    'git commit -am "remove the purge step"',
    'gh pr create --title x --body "never run git clean -fd"',
    'gh pr create --title="Delete all" --body=\'git push --force\'',
    'git commit -m "$(cat <<\'EOF\'\nfeat: drop table support\n\nnever run git clean -fd\nEOF\n)"',
  ]) approves(command);
});

test('a real delete verb or a real command still asks next to a message', () => {
  asks('az boards work-item delete --id 4 --yes');
  asks('az group delete --name rg --yes');
  asks('git commit -m "x" && git clean -fd');
  asks('echo "DROP TABLE x" | sqlcmd -S localhost');
  asks('git commit -m "$(rm -rf x)"');
});

test('the process contract: the hook exits 0 and speaks the PreToolUse JSON, and agrees with the in-process guards', () => {
  const sample = ['git push origin main', 'bash -c "git push --force origin feature/x"', 'git status', 'cat .env', 'dotnet test --no-build'];
  for (const command of sample) {
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: onFeature });
    assert.deepEqual(spawnRaw(input).decision, runRaw(input).decision, command);
  }
  assert.equal(spawnRaw(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cat .env' }, cwd: onFeature })).decision, 'deny');
});

test('a shell write into the Claude configuration asks, whatever the spelling of the path', () => {
  const absolute = join(homedir(), '.claude', 'hooks', 'x.js').replaceAll(String.fromCharCode(92), '/');
  const writes = [
    'echo x > ~/.claude/hooks/guard-shell.js', 'echo x >> $HOME/.claude/settings.json', 'echo x >> ${HOME}/.claude/settings.local.json',
    'echo x | tee ~/.claude/CLAUDE.md', 'echo x | tee -a ~/.claude/hooks/a.js', 'Set-Content -Path $env:USERPROFILE\\.claude\\settings.json -Value x',
    'Add-Content ~/.claude/hooks/a.js "x"', '"x" | Out-File ~/.claude/CLAUDE.md', 'Out-File -FilePath "$env:USERPROFILE/.claude/hooks/x.js" -InputObject x',
    'sed -i s/a/b/ ~/.claude/settings.json', 'sed --in-place s/a/b/ ~/.claude/hooks/x.js', 'cp evil.js ~/.claude/hooks/guard-shell.js',
    'Copy-Item evil.js -Destination $HOME\\.claude\\hooks\\x.js', 'mv new.json ~/.claude/settings.json', `echo x > ${absolute}`,
    'bash -c "echo x > ~/.claude/hooks/y.js"', 'docker exec c sh -c "tee ~/.claude/CLAUDE.md"', 'echo x 1> ~/.claude/CLAUDE.md', 'echo x >~/.claude/CLAUDE.md',
  ];
  for (const command of writes) asks(command, /Claude configuration/);
});

test('a relative path inside ~/.claude counts, and reads, listings and other files there do not', () => {
  const inClaude = (command) => run(command, join(homedir(), '.claude'));
  assert.equal(inClaude('echo x > hooks/x.js').decision, 'ask');
  assert.equal(inClaude('echo x > settings.json').decision, 'ask');
  assert.equal(inClaude('echo x > notes.txt').decision, 'approve');
  for (const command of [
    'cat ~/.claude/settings.json', 'ls ~/.claude/hooks', 'cp ~/.claude/settings.json /tmp/backup.json', 'Get-Content ~/.claude/CLAUDE.md',
    'echo x > ~/.claude/other.txt', 'echo x > notes.txt', 'echo x > ~/.claude/hooks-notes/a.md', 'git diff 2>&1', 'tee out.log',
  ]) approves(command);
});

test('a check that throws is skipped, the others still answer, and the error is logged as one capped line', () => {
  const config = mkdtempSync(join(tmpdir(), 'guard-log-'));
  created.push(config);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
  // A non-string cwd makes the docker-cp check throw; the destructive check on the same line must still ask.
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'docker cp api:/x ./y && git clean -fd' }, cwd: {} });
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask');
  const log = join(config, '.cache', 'hook-errors.log');
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z guard-shell\/docker-cp: /);

  // Capped: a flood of errors never grows the file past its limit.
  const flood = spawnSync(process.execPath, ['-e', `const { logError } = require(${JSON.stringify(join(dirname(HOOK), 'lib', 'cache.js'))});
    for (let i = 0; i < 400; i += 1) logError('flood', new Error('x'.repeat(250)));`], { encoding: 'utf8', env });
  assert.equal(flood.status, 0, flood.stderr);
  assert.ok(readFileSync(log, 'utf8').length < 20 * 1024, 'the log stays under its cap');
  assert.match(readFileSync(log, 'utf8').trim().split('\n').at(-1), / flood: /);
});

test('a missing file is an ordinary state and is not logged (no workspace map for az-pin)', () => {
  const config = mkdtempSync(join(tmpdir(), 'guard-log-'));
  created.push(config);
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'az boards query --wiql x' }, cwd: onFeature });
  spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config } });
  assert.throws(() => readFileSync(join(config, '.cache', 'hook-errors.log'), 'utf8'), /ENOENT/);
});

// A read-only agent (its `agent_type`, which the harness puts on every hook fired inside a subagent) never moves HEAD,
// the index or the stash: a reviewer once ran `git checkout <sha>` and left the worktree on a detached HEAD.
test('a read-only agent is denied git checkout, switch, reset, stash, rebase, commit and push', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'guard-ro-'));
  for (const command of ['git checkout 26460bf', 'git -C C:/repo switch main', 'git reset --hard HEAD~1', 'git stash',
    'git rebase main', 'git commit -m x', 'git push', 'git status && git checkout -b x', 'git stash -m list', 'git stash push -m show']) {
    for (const agent_type of ['code-reviewer', 'Explore', 'review-security']) {
      const r = evaluate({ tool_name: 'Bash', tool_input: { command }, cwd, agent_id: 'a1', agent_type });
      assert.equal(r?.decision, 'deny', `${agent_type}: ${command}`);
      assert.match(r.reason, /read-only agent/);
    }
  }
  rmSync(cwd, { recursive: true, force: true });
});

test('a read-only agent may still read git; an editing agent or the main session is not denied by this rule', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'guard-ro-'));
  for (const command of ['git diff 26460bf..HEAD', 'git log --oneline -5', 'git show 26460bf', 'git status', 'git stash list', 'git branch --show-current']) {
    assert.notEqual(evaluate({ tool_name: 'PowerShell', tool_input: { command }, cwd, agent_id: 'a1', agent_type: 'code-reviewer' })?.decision, 'deny', command);
  }
  for (const extra of [{ agent_id: 'a1', agent_type: 'implementer' }, {}]) {
    assert.notEqual(evaluate({ tool_name: 'Bash', tool_input: { command: 'git checkout 26460bf' }, cwd, ...extra })?.decision, 'deny', JSON.stringify(extra));
  }
  rmSync(cwd, { recursive: true, force: true });
});

test('given agent_type analyst, when it runs git commit, then the shell guard denies', () => {
  // Given
  const payload = { tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: tmpdir(), agent_id: 'a1', agent_type: 'analyst' };
  // When
  const r = evaluate(payload);
  // Then
  assert.equal(r?.decision, 'deny');
  assert.match(r.reason, /read-only agent \(analyst\)/);
});

test('given agent_type db-analyst, when it runs git push, then the shell guard denies', () => {
  // Given
  const payload = { tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: tmpdir(), agent_id: 'a1', agent_type: 'db-analyst' };
  // When
  const r = evaluate(payload);
  // Then
  assert.equal(r?.decision, 'deny');
  assert.match(r.reason, /read-only agent \(db-analyst\)/);
});

const TRACKER_WRITES = [
  'az boards work-item create --title x --type Task', 'az boards work-item update --id 5 --state Done', 'az boards work-item delete --id 5',
  'az boards work-item relation add --id 5 --relation-type parent --target-id 6', 'az boards work-item relation remove --id 5 --relation-type parent --target-id 6',
  'az repos pr create --title x', 'az repos pr update --id 3 --title y', 'az repos pr set-vote --id 3 --vote approve',
  'az repos pr reviewer add --id 3 --reviewers a', 'az repos pr work-item add --id 3 --work-items 5',
  'az devops wiki page create --wiki w --path p', 'az devops wiki page update --wiki w --path p', 'az devops wiki page delete --wiki w --path p',
  'gh pr create --fill', 'gh pr edit 3 --title x', 'gh pr merge 3', 'gh pr close 3', 'gh pr comment 3 -b x', 'gh pr review 3 --approve', 'gh pr ready 3',
  'gh issue create -t x', 'gh issue edit 3', 'gh issue close 3', 'gh issue comment 3 -b x', 'gh issue delete 3',
  'gh api repos/o/r/issues -X POST', 'gh api repos/o/r/pulls/3 --method PATCH', 'gh api repos/o/r/x --method=DELETE', 'gh api repos/o/r/x -f title=t',
  'git status && az repos pr create --title x', 'pwsh -c "gh pr merge 3"',
  'az devops invoke --area git --resource pullRequestThreads --http-method POST --in-file b.json', 'az rest -m patch --url u --body b',
  'az repos pr checkout --id 3', 'az repos pr reviewer remove --id 3 --reviewers a', 'az repos pr work-item remove --id 3 --work-items 5',
  'gh pr checkout 3', 'gh pr reopen 3', 'gh pr update-branch 3', 'gh issue reopen 3', 'gh issue transfer 3 o/r2',
  'gh pr -R o/r comment 3 -b x', 'gh api repos/o/r/issues/1/comments -fbody=hi', 'gh api graphql -f query="mutation { addComment(input: {}) { clientMutationId } }"',
];

test('given agent_type analyst, when it runs a tracker or pull request write, then the shell guard denies and names the agent', () => {
  // Given
  const cwd = tmpdir();
  for (const command of TRACKER_WRITES) {
    // When
    const r = evaluate({ tool_name: 'Bash', tool_input: { command }, cwd, agent_id: 'a1', agent_type: 'analyst' });
    // Then
    assert.equal(r?.decision, 'deny', command);
    assert.match(r.reason, /read-only agent \(analyst\).*return the write to the caller/i, command);
  }
});

test('given agent_type analyst, when it reads the tracker or a pull request, then the shell guard does not deny', () => {
  // Given
  const cwd = tmpdir();
  for (const command of ['az boards work-item show --id 5', 'az repos pr list', 'az repos pr show --id 3', 'az devops wiki page show --wiki w --path p',
    'gh pr view 3', 'gh pr list', 'gh pr diff 3', 'gh issue view 3', 'gh issue list', 'gh api repos/o/r/pulls/3', 'gh api repos/o/r/pulls/3 -X GET',
    'az devops invoke --area wit --resource workitems --route-parameters id=5', 'az rest --url u', 'gh pr -R o/r view 3',
    'gh api graphql -f query="{ repository(owner: \\"o\\", name: \\"r\\") { id } }"']) {
    // When
    const r = evaluate({ tool_name: 'Bash', tool_input: { command }, cwd, agent_id: 'a1', agent_type: 'analyst' });
    // Then
    assert.notEqual(r?.decision, 'deny', command);
  }
});

test('given the main session or an implementer, when it runs a tracker write, then the read-only rule does not deny', () => {
  // Given
  const cwd = tmpdir();
  for (const extra of [{}, { agent_id: 'a1', agent_type: 'implementer' }]) {
    for (const command of ['gh pr comment 3 -b x', 'gh issue create -t x', 'az boards work-item relation add --id 5 --relation-type parent --target-id 6']) {
      // When
      const r = evaluate({ tool_name: 'Bash', tool_input: { command }, cwd, ...extra });
      // Then
      assert.notEqual(r?.decision, 'deny', `${JSON.stringify(extra)} ${command}`);
    }
  }
});

// /retro 2026-11-03: `browser-use <<'PY' … PY` from Bash ended in exit 127 twice; the plugin is reached through its MCP tools.
const { checkBrowserUseCli } = createRequire(import.meta.url)('../hooks/lib/browser-use-cli.js');

test('browser-use run from a shell without the CLI on the PATH is denied, naming the MCP tools', () => {
  const empty = mkdtempSync(join(tmpdir(), 'guard-bu-'));
  for (const command of ["browser-use <<'PY'\nprint(list_tabs())\nPY", 'cd x && browser-use run', 'bash -c "browser-use run"', 'C:/tools/browser-use.exe run']) {
    const r = checkBrowserUseCli(command, empty, '', empty);
    assert.ok(r, command);
    assert.match(r.reason, /mcp__plugin_browser-use_browser-use__browser_exec/);
  }
  rmSync(empty, { recursive: true, force: true });
});

test('browser-use is left alone when the CLI is installed or only mentioned', () => {
  const bin = mkdtempSync(join(tmpdir(), 'guard-bu-'));
  const none = mkdtempSync(join(tmpdir(), 'guard-bu-'));
  writeFileSync(join(bin, 'browser-use.exe'), '');
  assert.equal(checkBrowserUseCli("browser-use <<'PY'\nPY", bin, '.EXE', none), null);   // on the PATH, by PATHEXT
  assert.equal(checkBrowserUseCli("browser-use <<'PY'\nPY", `"${bin}"`, '.EXE', none), null);   // a quoted PATH entry
  mkdirSync(join(none, '.local', 'bin'), { recursive: true });
  writeFileSync(join(none, '.local', 'bin', 'browser-use'), '');
  assert.equal(checkBrowserUseCli('browser-use run', '', '', none), null);   // only in ~/.local/bin
  const home = mkdtempSync(join(tmpdir(), 'guard-bu-'));
  for (const command of ['echo browser-use', 'grep -rn browser-use skills', 'git log --grep browser-use', "cat <<'EOF' > f\nbrowser-use run\nEOF", "$s = @'\nbrowser-use run\n'@", 'command -v browser-use']) {
    assert.equal(checkBrowserUseCli(command, '', '', home), null, command);
  }
  // an explicit path that exists runs; `<<<` opens no body, so the next line still counts
  assert.equal(checkBrowserUseCli(`${join(bin, 'browser-use.exe')} run`, '', '.EXE', home), null);
  assert.equal(checkBrowserUseCli(`${join(bin, 'browser-use')} run`, '', '.EXE', home), null);
  assert.ok(checkBrowserUseCli('cat <<< "hi"\nbrowser-use run', '', '', home));
  for (const d of [bin, none, home]) rmSync(d, { recursive: true, force: true });
});

test('the shell guard denies browser-use through evaluate when the CLI is missing', () => {
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const empty = mkdtempSync(join(tmpdir(), 'guard-bu-'));
  Object.assign(process.env, { PATH: empty, HOME: empty, USERPROFILE: empty });
  try {
    assert.equal(evaluate({ tool_name: 'Bash', tool_input: { command: "browser-use <<'PY'\nPY" }, cwd: onFeature })?.decision, 'deny');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(empty, { recursive: true, force: true });
  }
});

// A read-only agent gets an allow-list of git read verbs: anything else (or unknown) is denied.
const asAgent = (command, extra = {}, tool_name = 'Bash') =>
  evaluate({ tool_name, tool_input: { command }, cwd: onFeature, agent_id: 'a1', agent_type: 'code-reviewer', ...extra });

test('given agent_type code-reviewer, when it runs a git write verb, then guard-shell denies it', () => {
  // Given
  const commands = ['git pull', 'git merge main', 'git clean -n', 'git add .', 'git restore f', 'git cherry-pick abc', 'git revert abc', 'git am p.patch',
    'git apply p.diff', 'git mv a b', 'git rm f', 'git gc', 'git prune', 'git update-ref refs/heads/x abc', 'git config --global x y'];

  for (const command of commands) {
    // When
    const r = asAgent(command);

    // Then
    assert.equal(r?.decision, 'deny', command);
  }
});

test('given agent_type code-reviewer, when it runs a git read verb, then guard-shell does not deny it', () => {
  // Given
  const commands = ['git diff a..b', 'git show abc', 'git log -5', 'git blame f', 'git rev-list HEAD', 'git rev-parse HEAD', 'git ls-files', 'git ls-tree HEAD',
    'git grep foo', 'git cat-file -p abc', 'git status', 'git fetch', 'git merge-base a b', 'git describe', 'git shortlog -s', 'git for-each-ref', 'git show-ref'];

  for (const command of commands) {
    // When
    const r = asAgent(command);

    // Then
    assert.notEqual(r?.decision, 'deny', command);
  }
});

test('given agent_type code-reviewer, when it runs branch, tag, stash, worktree or remote, then only the read forms pass', () => {
  // Given
  const reads = ['git branch', 'git branch -a', 'git branch --list "x*"', 'git branch --show-current', 'git tag', 'git tag -l', 'git tag --points-at HEAD',
    'git stash list', 'git stash show', 'git worktree list', 'git remote', 'git remote -v', 'git remote get-url origin', 'git remote show origin'];
  const writes = ['git branch topic', 'git branch -D topic', 'git tag v1', 'git tag -d v1', 'git stash drop', 'git stash pop', 'git worktree add ../w', 'git worktree remove ../w',
    'git remote add x u', 'git remote remove x', 'git remote set-url x u'];

  for (const command of reads) {
    // When / Then
    assert.notEqual(asAgent(command)?.decision, 'deny', command);
  }
  for (const command of writes) {
    // When / Then
    assert.equal(asAgent(command)?.decision, 'deny', command);
  }
});

test('given global flags before the verb, when a read-only agent runs a write, then the verb is still found', () => {
  // Given
  const commands = ['git -C . pull', 'git --no-pager add .', 'git -c core.x=1 merge main', 'git --git-dir /x --work-tree /y clean -n', 'git -C /r -c a=b rm f'];

  for (const command of commands) {
    // When / Then
    assert.equal(asAgent(command)?.decision, 'deny', command);
  }
  assert.notEqual(asAgent('git -C . --no-pager diff')?.decision, 'deny');
});

test('given a git write in a substitution, a group or a wrapped shell, when a read-only agent runs it, then it denies', () => {
  // Given
  const commands = ['echo $(git pull)', '(git add .)', 'bash -c "git pull"', 'echo `git merge x`', 'sh -c "git status; git rm f"'];

  for (const command of commands) {
    // When / Then
    assert.equal(asAgent(command)?.decision, 'deny', command);
  }
});

test('given an unknown git verb or an alias, when a read-only agent runs it, then it denies', () => {
  // Given
  const commands = ['git frobnicate', 'git co main', 'git st', 'git lg'];

  for (const command of commands) {
    // When / Then
    assert.equal(asAgent(command)?.decision, 'deny', command);
  }
});

test('given a PowerShell call and a read-only agent, when it runs git pull, then it denies', () => {
  // Given / When
  const r = asAgent('git pull', {}, 'PowerShell');

  // Then
  assert.equal(r?.decision, 'deny');
});

test('given no agent_type, when git pull runs, then guard-shell does not deny', () => {
  // Given / When
  const r = evaluate({ tool_name: 'Bash', tool_input: { command: 'git pull' }, cwd: onFeature });

  // Then
  assert.notEqual(r?.decision, 'deny');
});
