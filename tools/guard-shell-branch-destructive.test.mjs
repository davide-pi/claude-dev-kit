// Tests for hooks/guard-shell.js: default branch and destructive verbs. Shared setup in guard-shell-shared.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { HOOK, SHA, created, fixture, spawnRaw, run, onDefault, onFeature, asks, approves } from './guard-shell-shared.test.mjs';

test('on the default branch, a commit or a push asks for confirmation', () => {
  for (const command of ['git commit -m "wip"', 'git push', 'git commit -am "wip" && git push']) {
    const { decision, reason } = run(command, onDefault);
    assert.equal(decision, 'ask', command);
    assert.match(reason, /default branch/, command);
  }
});

test('the action in the reason names what the command actually does', () => {
  assert.match(run('git commit -m "wip"', onDefault).reason, /direct commit here/);
  assert.match(run('git push origin main', onDefault).reason, /direct push here/);
  assert.match(run('git commit -m "wip" && git push', onDefault).reason, /direct commit and push here/);
});

test('a command that only mentions a verb is not a commit or a push', () => {
  // Regression: `git\b[^;&|]*\bcommit\b` matched the word anywhere after `git`, so read-only
  // commands prompted on the default branch.
  const readOnly = [
    'git log --grep=commit',
    'git config --global push.default simple',
    'git show --stat HEAD',
    'git log --oneline origin/main..HEAD',
    'ls -la',
    'echo push',
  ];
  for (const command of readOnly) {
    assert.equal(run(command, onDefault).decision, 'approve', command);
  }
});

test('a dry run changes nothing, so it is approved', () => {
  assert.equal(run('git push --dry-run', onDefault).decision, 'approve');
  assert.equal(run('git push --dry-run origin main', onFeature).decision, 'approve');
  assert.equal(run('git push -n origin main', onFeature).decision, 'approve');
  assert.equal(run('git push origin main --dry-run', onFeature).decision, 'approve');
});

test('a dry run does not cover a real push chained after it', () => {
  // Regression: `--dry-run` was tested against the whole line, so this whole call was approved.
  for (const command of [
    'git push --dry-run origin main && git push origin main',
    'git push --dry-run origin main; git push origin main',
    'git push --dry-run origin main | tee log.txt && git push origin main',
  ]) {
    assert.equal(run(command, onFeature).decision, 'ask', command);
  }
  // A bare `git push` reaches the default branch only from the default branch itself.
  for (const command of ['git push --dry-run && git push', 'git push --dry-run && git commit -m "wip"']) {
    assert.equal(run(command, onDefault).decision, 'ask', command);
  }
  assert.equal(run('git push --dry-run && git push', onFeature).decision, 'approve');
});

test('`-n` means --no-verify on a commit, not a dry run', () => {
  assert.equal(run('git commit -n -m "wip"', onDefault).decision, 'ask');
});

test('from a working branch, only a push that reaches the default branch asks', () => {
  const reaches = [
    'git push origin main',
    'git push -u origin main',
    'git push origin HEAD:main',
    'git push origin HEAD:refs/heads/main',
    'git push origin +main',
    'git push --set-upstream origin main',
    'git push --force-with-lease origin main',
  ];
  for (const command of reaches) {
    const { decision, reason } = run(command, onFeature);
    assert.equal(decision, 'ask', command);
    assert.match(reason, /pushes to 'main'/, command);
  }

  const stays = [
    'git push',
    'git push -u origin feature/x',
    'git push origin feature/main-cleanup', // the name must be a whole ref part
    'git push origin main-line',
    'git commit -m "wip"',
    'git commit -m "push to main"', // the message is not a ref
    'git commit --amend --no-edit',
  ];
  for (const command of stays) {
    assert.equal(run(command, onFeature).decision, 'approve', command);
  }
});

test('a push of every ref asks, because no name matching can clear it', () => {
  // Regression: `--all` / `--mirror` never name the branch, so the token match could not see them.
  for (const command of ['git push --all origin', 'git push --mirror origin', 'git push --all']) {
    const { decision, reason } = run(command, onFeature);
    assert.equal(decision, 'ask', command);
    assert.match(reason, /every ref/, command);
  }
});

test('global options are skipped when reading the subcommand', () => {
  // The author's own push command: quoted values with spaces, two `-c` pairs before the verb.
  const real = "git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin feature/x";
  assert.equal(run(real, onFeature).decision, 'approve');
  assert.equal(run(real.replace('feature/x', 'main'), onFeature).decision, 'ask');
  assert.equal(run('git --no-pager push origin main', onFeature).decision, 'ask');
  assert.equal(run('git.exe push origin main', onFeature).decision, 'ask');
});

test('`git -C` picks the repo the command really acts on', () => {
  // cwd sits on the default branch, `-C` points at the working-branch repo: no direct-commit prompt.
  assert.equal(run(`git -C ${onFeature} commit -m "wip"`, onDefault).decision, 'approve');
  // And the other way round.
  assert.match(run(`git -C ${onDefault} commit -m "wip"`, onFeature).reason, /default branch/);
});

test('`git -C` reads a path that holds a message-like flag whole (the flaky `-F` in a random temp name)', () => {
  // Regression: `-F` mid-path was read as the --file flag and its "value" replaced, about 1 run in 30.
  for (const prefix of ['guard-F', 'guard-m', 'guard-am', 'guard--file']) {
    const feature = fixture('feature/x', 'main', prefix);
    const main = fixture('main', 'main', prefix);
    assert.equal(run(`git -C ${feature} commit -m "wip"`, main).decision, 'approve', prefix);
    assert.match(run(`git -C ${main} commit -m "wip"`, feature).reason, /default branch/, prefix);
  }
});

test('a repo whose default branch is not main is handled by name', () => {
  const trunk = fixture('feature/y', 'release/v1');
  assert.match(run('git push origin release/v1', trunk).reason, /pushes to 'release\/v1'/);
  assert.equal(run('git push origin release/v2', trunk).decision, 'approve');
});

test('an empty or incomplete payload is approved, an unreadable one asks', () => {
  assert.equal(spawnRaw('not json at all').decision, 'ask');
  for (const input of ['', '{}', JSON.stringify({ tool_input: {} }), JSON.stringify({ tool_input: { command: '   ' } })]) {
    assert.equal(spawnRaw(input).decision, 'approve', input);
  }
  assert.equal(run('git commit -m "wip"', join(tmpdir(), 'does-not-exist-guard')).decision, 'approve');
  assert.equal(run('git commit -m "wip"', tmpdir()).decision, 'approve'); // outside any repo
});

test('dropping a database, schema or table', () => {
  asks('docker exec -i sqlserver /opt/mssql-tools/bin/sqlcmd -U sa -Q "DROP DATABASE Sales"', /drops a database/);
  asks('sqlcmd -S localhost -Q "drop table dbo.Orders"');
  asks('docker compose exec -T db psql -U postgres -c "DROP SCHEMA public CASCADE"');
  asks('sqlcmd -S localhost -Q "IF EXISTS (SELECT 1 FROM sys.tables) DROP TABLE dbo.Tmp"');
  asks('docker exec pg dropdb --if-exists sales', /through the database CLI/);
});

test('truncating a table', () => {
  asks('sqlcmd -S localhost -Q "TRUNCATE TABLE dbo.AuditLog"', /truncates a table/);
  asks('docker exec pg psql -U postgres -d sales -c "truncate orders"');
});

test('the migration tool dropping or unwinding the model', () => {
  asks('dotnet ef database drop --force --project src/App.Data', /migration tool dropping/);
  asks('dotnet ef migrations remove --project src/App.Data', /deletes the last migration/);
  asks('dotnet-ef database drop -f');
});

test('flushing a cache', () => {
  // On a dev host redis-cli is not otherwise restricted, so the flush rules are what stops a wipe.
  asks('docker exec -it redis redis-cli FLUSHALL', /EVERY key/);
  asks('redis-cli -h localhost -n 3 flushdb', /selected cache database/);
  asks('docker exec memcached bash -c "echo flush_all | nc localhost 11211"');
});

test('tearing containers down with their volumes', () => {
  asks('docker compose down -v', /WITH its volumes/);
  asks('docker compose -f docker-compose.dev.yml down --volumes --remove-orphans');
  asks('docker-compose down -v --rmi local');
});

test('pruning containers and deleting volumes', () => {
  asks('docker system prune -a --volumes -f', /prunes container resources/);
  asks('docker builder prune');
  asks('docker volume rm app_sqlserver_data', /deletes a container volume/);
  asks('podman volume prune -f');
});

test('purging or deleting a broker queue', () => {
  asks('docker exec rabbit rabbitmqctl purge_queue orders.dlq', /broker queue/);
  asks('docker exec rabbit rabbitmqadmin delete queue name=orders');
  asks('az servicebus queue delete --namespace-name bus --resource-group rg --name orders');
});

test('deleting a cloud, Azure DevOps or Kubernetes resource', () => {
  asks('az group delete --name rg-dev --yes --no-wait', /cloud or Azure DevOps resource/);
  asks('az boards work-item delete --id 4211 --yes');
  asks('az storage blob delete-batch --source container', /cloud or Azure DevOps resource/);
  // A `--delete-*` flag is a setting, not a deletion: the compliant PR create must not prompt.
  approves('az repos pr create --title T --work-items 1 --squash true --delete-source-branch true');
  asks('kubectl delete deployment api -n staging', /Kubernetes resource/);
  asks('kubectl -n staging delete pvc data-api-0');
  asks('helm uninstall api -n staging', /Helm release/);
  asks('terraform destroy -auto-approve', /Terraform state/);
  asks('aws s3api delete-bucket --bucket app-artifacts');
  asks('gh repo delete owner/name --yes', /on the remote host/);
});

test('switching the machine-global az account', () => {
  asks('az account set --subscription 00000000-0000-0000-0000-000000000000', /machine/);
  asks('az account show && az account set -s Sub');
  asks('Write-Host go; az account set --subscription Sub');
  approves('az account show --query user.name -o tsv');
  approves('az account set --help');
  approves('grep -rn "az account set" skills');
});

test('given a local branch deletion, forced or not, when the guard reads it, then it lets it through (the owner\'s night-work choice: the reflog keeps the commits)', () => {
  // Given / When / Then
  for (const command of ['git branch -D feature/spike', 'git branch --delete --force feature/spike', 'git branch -Dr origin/feature/spike',
    'git branch -d merged', 'git branch --delete merged', 'git -C . branch -dr origin/x', 'git -C ../wt branch -D x']) approves(command);
});

test('local git actions with no undo: stash drop, forced worktree removal, reflog expiry', () => {
  asks('git stash drop', /stashed work/);
  asks('git stash drop stash@{2}');
  asks('git stash clear');
  asks('git -C ../wt stash drop');
  approves('git worktree remove --force ../wt');
  approves('git -C repo worktree remove -f ../wt');
  asks('git reflog expire --expire=now --all', /reflog/);
  approves('git stash push -u -m "wip"');
  approves('git stash list');
  approves('git stash pop');
  approves('git worktree remove ../wt');
  approves('git worktree add ../wt feature/x');
  approves('git reflog');
  approves('Clear-Host');
});

test('the danger is found inside a pipeline, not only at the head of the line', () => {
  asks('dotnet build && docker compose down -v && docker compose up -d');
  asks('echo "cleaning" ; docker exec -i db sqlcmd -Q "DROP TABLE dbo.T"');
  asks('docker exec -i db sqlcmd -Q "DROP TABLE dbo.T" | tee drop.log');
});

test('a searcher hunting for the danger is not the danger', () => {
  approves('grep -rn "DROP TABLE" ./src');
  approves('rg -i "drop database" --glob "*.sql"');
  approves('findstr /S /I "TRUNCATE TABLE" *.sql');
  approves('Select-String -Path .\\migrations\\*.sql -Pattern "DROP SCHEMA"');
  approves('git grep -n "flushall"');
  approves('git log --oneline --grep="drop table"');
  approves('git log -p -- src/Migrations');
});

test('a comment is not an instruction', () => {
  approves('dotnet publish # then dotnet ef database drop, once the backup is taken');
  approves('docker compose up -d   # remember: docker compose down -v wipes the volumes');
  approves('sqlcmd -S localhost -Q "-- DROP TABLE dbo.Orders was reverted"');
  approves('sqlcmd -S localhost -Q "/* DROP DATABASE Sales */ SELECT 1"');
});

test('a file path that merely contains the word is not a statement', () => {
  approves('psql -h localhost -U postgres -f scripts/drop-old-tables.sql'); // no -h: denied, no host
  approves('code src/Migrations/20240101_DropTable.cs');
  approves('cat ./scripts/database-drop.ps1');
  approves('sqlcmd -S localhost -i migrations/truncate-staging.sql');
  approves('git add tools/prune-artifacts.js');
});

test('a dry run, a what-if or a help page changes nothing', () => {
  approves('dotnet ef database drop --dry-run');
  approves('kubectl delete deployment api --dry-run=client -o yaml');
  approves('docker system prune --help');
  approves('az group delete --name rg-dev --what-if');
  approves('Remove-AzResourceGroup -Name rg-dev -WhatIf');
  approves('dotnet ef migrations remove --help');
});

test('a SELECT that merely mentions the word is read-only', () => {
  approves('sqlcmd -S localhost -Q "SELECT name FROM sys.tables WHERE name = \'DropLog\'"');
  approves('sqlcmd -S localhost -Q "SELECT \'DROP TABLE \' + name FROM sys.tables"');
  approves('docker exec pg psql -c "select * from pg_stat_activity where query like \'%truncate%\'"');
  approves('sqlcmd -S localhost -Q "SHOW TABLES"');
});

test('a generated statement is still caught once the read-only part is stripped', () => {
  // The regression the SELECT rule could have caused: blanking too much.
  asks('sqlcmd -S localhost -Q "SELECT 1; DROP TABLE dbo.Tmp"');
});

test('the everyday commands stay silent', () => {
  const quiet = [
    'dotnet build # raw',             // without `# raw` it is rewritten: tools/output-filter.test.mjs
    'dotnet test --no-build # raw',   // without `# raw` it is rewritten: tools/output-filter.test.mjs
    'npm run build',
    'npm uninstall lodash',
    'docker compose up -d',
    'docker compose down',
    'docker compose restart api',
    'docker ps -a',
    'git push origin feature/x',
    'git status',
    'az pipelines runs list --top 5',
    'az repos pr list --status active',
    'kubectl get pods -n staging',
    'kubectl logs deployment/api',
    'redis-cli GET user:1',
    'ls -la',
    'Get-ChildItem -Recurse',
  ];
  for (const command of quiet) approves(command);
});

test('when both checks fire, one prompt carries both reasons', () => {
  const { decision, reason } = run('git push origin main && docker compose down -v', onFeature);
  assert.equal(decision, 'ask');
  assert.match(reason, /pushes to 'main'/);
  assert.match(reason, /WITH its volumes/);
});

test('a destructive action on the default branch is still caught', () => {
  const { decision, reason } = run('git stash drop', onDefault);
  assert.equal(decision, 'ask');
  assert.match(reason, /stashed work/);
  assert.doesNotMatch(reason, /default branch/);
});

test('the shell guard wired in settings.json still denies with CLAUDE_HOOKS unset (default hooks directory)', () => {
  const settings = JSON.parse(readFileSync(join(dirname(HOOK), '..', 'settings.json'), 'utf8'));
  const wiring = settings.hooks.PreToolUse.find((g) => g.matcher === 'Bash|PowerShell').hooks[0];
  assert.equal(wiring.command, 'node');

  // A fake home whose ~/.claude/hooks is a copy of the kit's: the only place the default can point.
  const home = mkdtempSync(join(tmpdir(), 'guard-home-'));
  created.push(home);
  cpSync(dirname(HOOK), join(home, '.claude', 'hooks'), { recursive: true });

  const run = (env) => {
    const clean = { ...process.env, HOME: home, USERPROFILE: home };
    delete clean.CLAUDE_HOOKS;
    const r = spawnSync(process.execPath, wiring.args, {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sqlcmd -S prod-sql.example.com -Q "SELECT 1"' }, cwd: home }),
      encoding: 'utf8', env: { ...clean, ...env },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'approve';
  };

  assert.equal(run({}), 'deny', 'unset: the default directory');
  assert.equal(run({ CLAUDE_HOOKS: dirname(HOOK) }), 'deny', 'set: that directory');
});

test('settings.json denies `az account set` outright in both shells', () => {
  const settings = JSON.parse(readFileSync(join(dirname(HOOK), '..', 'settings.json'), 'utf8'));
  for (const rule of ['Bash(az account set*)', 'PowerShell(az account set*)']) {
    assert.ok(settings.permissions.deny.includes(rule), rule);
  }
});

test('settings.json: deletes ask instead of deny, the unrecoverable ones stay denied', () => {
  const { allow, deny, ask } = JSON.parse(readFileSync(join(dirname(HOOK), '..', 'settings.json'), 'utf8')).permissions;
  for (const shell of ['Bash', 'PowerShell']) {
    for (const rule of ['kubectl delete *', 'az repos delete*', 'az pipelines delete*', 'git push --delete*', 'git push -f*']) {
      assert.ok(ask.includes(`${shell}(${rule})`), `${shell}(${rule}) asks`);
      assert.ok(!deny.includes(`${shell}(${rule})`), `${shell}(${rule}) is not denied`);
    }
    for (const rule of ['az group delete*', 'git clean -f*', 'docker volume rm*', 'dotnet ef database drop*']) {
      assert.ok(deny.includes(`${shell}(${rule})`), `${shell}(${rule}) stays denied`);
    }
    assert.ok(!ask.includes(`${shell}(git push*)`), 'a plain push is left to default-branch.js and the classifier');
    assert.ok(!ask.includes(`${shell}(docker exec *)`), 'docker exec is read by sql-target.js and destructive.js');
    assert.ok(allow.includes(`${shell}(az repos pr update *)`), 'the PR update the hook gates is allowed');
  }
  assert.ok(ask.includes('Bash(rm -rf *)') && ask.includes('Bash(rm -fr *)') && ask.includes('Bash(rm -r *)'));
});

test('settings.json: secret denies are absolute, and no rule carries a placeholder that would leak into the live file', () => {
  const { permissions } = JSON.parse(readFileSync(join(dirname(HOOK), '..', 'settings.json'), 'utf8'));
  for (const rule of ['Read(//**/.env)', 'Read(//**/*.pem)', 'Read(//**/*.pfx)', 'Read(~/.config/gh/hosts.yml)']) {
    assert.ok(permissions.deny.includes(rule), rule);
  }
  assert.ok(!permissions.deny.includes('Read(**/.env.*)'), '.env.example must stay readable');
  const placeholders = Object.values(permissions).flat().filter((r) => typeof r === 'string' && /<[^>]+>/.test(r));
  assert.deepEqual(placeholders, []);
});

/** A linked worktree on `current` of a repo whose default branch is `defaultBranch`. */
function worktreeFixture(current, defaultBranch = 'main') {
  const main = fixture(defaultBranch);
  const wt = mkdtempSync(join(tmpdir(), 'guard-wt-'));
  created.push(wt);
  const gitDir = join(main, '.git', 'worktrees', 'wt');
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, 'HEAD'), `ref: refs/heads/${current}\n`);
  writeFileSync(join(gitDir, 'commondir'), '../..\n');
  writeFileSync(join(wt, '.git'), `gitdir: ${gitDir}\n`);
  return wt;
}

test('in a linked worktree the default branch is read from the common directory', () => {
  const onFeatureWt = worktreeFixture('feature/x');
  const pushMain = run('git push origin main', onFeatureWt);
  assert.equal(pushMain.decision, 'ask');
  assert.match(pushMain.reason, /pushes to 'main'/);
  assert.equal(run('git push origin feature/x', onFeatureWt).decision, 'approve');

  const onMainWt = worktreeFixture('main');
  const commit = run('git commit -m "wip"', onMainWt);
  assert.equal(commit.decision, 'ask');
  assert.match(commit.reason, /default branch/);
});

test('a push that deletes or force-overwrites a ref asks, whatever the spelling', () => {
  for (const command of [
    'git push origin --delete old', 'git push -d origin old', 'git push -fu origin feature/x',
    'git push origin feature/x --force', 'git push --force-with-lease origin feature/x',
    'git push origin +feature/x', 'git push origin :feature/old', 'git push --force-if-includes origin x',
  ]) asks(command, /deletes or force-overwrites/);
  for (const command of [
    'git push origin feature/x', 'git push -u origin feature/x', 'git push --set-upstream origin feature/fix-bug-d',
    'git push origin HEAD:feature/y', 'git push --follow-tags', 'git push --dry-run -f origin x',
  ]) approves(command);
});

test('a recursive or forced delete asks, in either shell and behind sudo or xargs', () => {
  for (const command of [
    'rm -rf node_modules', 'rm -fr dist', 'rm -r build', 'rm -R build', 'rm --recursive dist', 'sudo rm -rf /var/x',
    'ls | xargs rm -rf', 'Remove-Item -Recurse -Force .\dist', 'Remove-Item dist -Force', 'ri dist -r', 'del /s /q dist', 'rd /s dist',
  ]) asks(command, /recursively or by force/);
  for (const command of [
    'rm notes.txt', 'rm -i notes.txt', 'Remove-Item notes.txt', 'Remove-Item -Path a.txt -LiteralPath b.txt',
    'git rm -r --cached dist', 'echo rm -rf', 'grep -rn "rm -rf" scripts',
  ]) approves(command);
});

test('given a git push named only as text, when run on the default branch, then it does not ask', () => {
  // Given
  const commands = ['echo git push origin main', 'git log --grep "git push main"'];
  for (const command of commands) {
    // When
    const { decision } = run(command, onDefault);

    // Then
    assert.equal(decision, 'approve', command);
  }
});

test('given a real push in a substitution, group, wrapper, keyword body or assignment, when run on the default branch, then each asks', () => {
  // Given
  const commands = [
    '$(git push origin main)', '(git push origin main)', 'command git push',
    '"C:\\Program Files\\Git\\cmd\\git.exe" push origin main',
    'if x; then git push origin main; fi', '$r = git push origin main',
  ];
  for (const command of commands) {
    // When
    const { decision, reason } = run(command, onDefault);

    // Then
    assert.equal(decision, 'ask', command);
    assert.match(reason, /default branch/, command);
  }
});
