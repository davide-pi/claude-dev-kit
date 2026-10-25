import { expect, test } from 'claude-code/testing'

import { spanText } from '../hooks/shared'
import {
  additionsDiff,
  aheadBehindSpans,
  azureRepo,
  capDiff,
  checkPerimeter,
  claimTime,
  claimsOf,
  diffHunks,
  editedPathOf,
  isAzureRemote,
  isDefaultBranch,
  isGithubRemote,
  parseAzurePr,
  parseCommits,
  parseCreatedPr,
  parseDefaultBranch,
  parseDoneClaims,
  parseEdited,
  parseGitStatus,
  parseGithubPr,
  parseNumstat,
  parsePerimeter,
  parseSavedPrs,
  parseWorktree,
  recordEdited,
  repoRelative,
  safeUrl,
  upsertPr,
} from '../hooks/work'

test('parseGitStatus counts staged, modified, untracked', () => {
  const out = '## feature/x...origin/feature/x [ahead 1]\nM  a.ts\n M b.ts\nMM c.ts\n?? d.ts\n'
  expect(parseGitStatus(out)).toEqual({ branch: 'feature/x', isDetached: false, staged: 2, modified: 2, untracked: 1, upstream: 'origin/feature/x', ahead: 1, behind: 0 })
  expect(parseGitStatus('## feature/x\nM  a.ts\n')).toEqual({ branch: 'feature/x', isDetached: false, staged: 1, modified: 0, untracked: 0 })
  expect(parseGitStatus('## No commits yet on main\n')?.branch).toBe('main')
  // a detached HEAD has no branch: git says `HEAD (no branch)`
  expect(parseGitStatus('## HEAD (no branch)\n M a.ts\n')).toEqual({ branch: 'HEAD', isDetached: true, staged: 0, modified: 1, untracked: 0 })
  expect(parseGitStatus('')).toBeUndefined()
})

test('parseWorktree is set only in a linked worktree', () => {
  expect(parseWorktree('.git\n.git\n/work/repo')).toBeUndefined()
  expect(parseWorktree('/work/repo/.git/worktrees/w\n/work/repo/.git\n/work/wt/w')).toBe('/work/wt/w')
})

test('isDefaultBranch: main, master, develop and the repo own default, nothing else', () => {
  for (const branch of ['main', 'master', 'develop']) expect(isDefaultBranch(branch)).toBe(true)
  expect(isDefaultBranch('trunk')).toBe(false)
  expect(isDefaultBranch('trunk', 'trunk')).toBe(true)
  expect(isDefaultBranch('feature/trunk', 'trunk')).toBe(false)
})

test('parseGitStatus: the upstream with the commits ahead and behind it', () => {
  expect(parseGitStatus('## feature/x...origin/feature/x [ahead 2, behind 1]\n')).toMatchObject({ branch: 'feature/x', upstream: 'origin/feature/x', ahead: 2, behind: 1 })
  expect(parseGitStatus('## feature/x...origin/feature/x [ahead 3]\n')).toMatchObject({ ahead: 3, behind: 0 })
  expect(parseGitStatus('## feature/x...origin/feature/x [behind 4]\n')).toMatchObject({ ahead: 0, behind: 4 })
  expect(parseGitStatus('## feature/x...origin/feature/x\n')).toMatchObject({ upstream: 'origin/feature/x', ahead: 0, behind: 0 })
  // no upstream, or one that is gone: nothing to count against
  expect(parseGitStatus('## feature/x\n')?.upstream).toBeUndefined()
  expect(parseGitStatus('## feature/x...origin/feature/x [gone]\n')?.upstream).toBeUndefined()
  expect(parseGitStatus('## HEAD (no branch)\n')?.upstream).toBeUndefined()
})

test('parseNumstat: tracked files with +/-, a binary one, then the untracked ones', () => {
  expect(parseNumstat('12\t3\tsrc/a.ts\0-\t-\timg.png\0', ['notes.md'])).toEqual([
    { path: 'src/a.ts', added: 12, deleted: 3 },
    { path: 'img.png', isBinary: true },
    { path: 'notes.md', isUntracked: true },
  ])
  expect(parseNumstat('0\t5\tdir with space/b c.ts\0', [])).toEqual([{ path: 'dir with space/b c.ts', added: 0, deleted: 5 }])
  expect(parseNumstat('', [])).toEqual([])
  expect(parseNumstat('garbage\0', [])).toEqual([])
})

test('parseGithubPr: an open PR with its title, review decision and the checks told passed, failed, pending', () => {
  const checks = [
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
    { __typename: 'CheckRun', status: 'QUEUED', conclusion: '' },
    { __typename: 'StatusContext', state: 'SUCCESS' },
    { __typename: 'StatusContext', state: 'PENDING' },
    { __typename: 'StatusContext', state: 'ERROR' },
  ]
  const json = (o: object) => JSON.stringify({ number: 42, title: 'Fix', state: 'OPEN', isDraft: false, ...o })
  expect(parseGithubPr(json({ reviewDecision: 'APPROVED', statusCheckRollup: checks }))).toEqual({
    number: 42,
    title: 'Fix',
    state: 'open',
    isDraft: false,
    review: 'approved',
    checks: { passed: 3, failed: 2, pending: 2 },
  })
  expect(parseGithubPr(json({ reviewDecision: 'CHANGES_REQUESTED', isDraft: true }))).toEqual({ number: 42, title: 'Fix', state: 'open', isDraft: true, review: 'changes' })
  expect(parseGithubPr(json({ url: 'https://github.com/example/orders/pull/42' }))?.url).toBe('https://github.com/example/orders/pull/42')
  expect(parseGithubPr(json({ reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [] }))?.review).toBe('pending')
  expect(parseGithubPr(json({ reviewDecision: '' }))?.review).toBeUndefined()
  expect(parseGithubPr(json({ state: 'MERGED' }))?.state).toBe('merged')
  expect(parseGithubPr(json({ state: 'CLOSED' }))?.state).toBe('closed')
  expect(parseGithubPr(json({ state: 'WEIRD' }))).toBeUndefined()
  expect(parseGithubPr(json({ number: 0 }))).toBeUndefined()
  expect(parseGithubPr(json({ number: '42' }))).toBeUndefined()
  expect(parseGithubPr('{}')).toBeUndefined()
  expect(parseGithubPr('not json')).toBeUndefined()
  expect(parseGithubPr('')).toBeUndefined()
})

test('parseAzurePr: the first PR of az repos pr list (active, completed or abandoned), its review from the reviewers votes, no checks', () => {
  const list = (o: object) => JSON.stringify([{ pullRequestId: 7, title: 'Faster', status: 'active', isDraft: false, ...o }])
  expect(parseAzurePr(list({ reviewers: [{ vote: 10 }, { vote: 0 }] }))).toEqual({ number: 7, title: 'Faster', state: 'open', isDraft: false, review: 'approved' })
  expect(parseAzurePr(list({ isDraft: true }))).toEqual({ number: 7, title: 'Faster', state: 'open', isDraft: true })
  expect(parseAzurePr(list({ repository: { webUrl: 'https://dev.azure.com/o/p/_git/r' } }))?.url).toBe('https://dev.azure.com/o/p/_git/r/pullrequest/7')
  expect(parseAzurePr(list({ reviewers: [{ vote: 10 }, { vote: -10 }] }))?.review).toBe('changes')
  expect(parseAzurePr(list({ reviewers: [{ vote: -5 }] }))?.review).toBe('changes')
  expect(parseAzurePr(list({ reviewers: [{ vote: 0 }, { vote: 0 }] }))?.review).toBe('pending')
  expect(parseAzurePr(list({ reviewers: [] }))?.review).toBeUndefined()
  expect(parseAzurePr(list({ status: 'completed' }))?.state).toBe('merged')
  expect(parseAzurePr(list({ status: 'abandoned' }))?.state).toBe('closed')
  expect(parseAzurePr(list({ status: 'notSet' }))).toBeUndefined()
  expect(parseAzurePr(list({ pullRequestId: 'x' }))).toBeUndefined()
  expect(parseAzurePr('[]')).toBeUndefined()
  expect(parseAzurePr('{}')).toBeUndefined()
  expect(parseAzurePr('not json')).toBeUndefined()
})

test('isAzureRemote and azureRepo: the project and repository an Azure DevOps remote names', () => {
  const SSH_USER = 'git' // kept apart so the URLs below are not read as e-mail addresses
  const https = 'https://dev.azure.com/<org>/proj/_git/orders'
  const ssh = `${SSH_USER}@ssh.dev.azure.com:v3/<org>/proj/orders`
  const old = 'https://<org>.visualstudio.com/proj/_git/orders'
  for (const url of [https, ssh, old]) {
    expect(isAzureRemote(`${url}\n`)).toBe(true)
    expect(azureRepo(url)).toEqual({ project: 'proj', repo: 'orders' })
  }
  expect(azureRepo('https://dev.azure.com/<org>/My%20Proj/_git/my%20repo')).toEqual({ project: 'My Proj', repo: 'my repo' })
  // the project's default repository carries the project's name
  expect(azureRepo('https://dev.azure.com/<org>/_git/orders')).toEqual({ repo: 'orders' })
  expect(isAzureRemote('https://github.com/example/orders')).toBe(false)
  expect(isAzureRemote('')).toBe(false)
  expect(azureRepo('https://github.com/example/orders')).toBeUndefined()
})

test('diffHunks: git diff without its header lines; a diff with no hunks is empty; carriage returns go', () => {
  const raw = 'diff --git a/x b/x\r\nindex 1..2 100644\r\n--- a/x\r\n+++ b/x\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n'
  expect(diffHunks(raw)).toBe('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')
  expect(diffHunks('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n')).toBe('')
  expect(diffHunks('')).toBe('')
})

test('capDiff: a long diff is cut before a hunk, else at a line, never mid-line', () => {
  const hunk = (n: number) => `@@ -${n},1 +${n},1 @@\n-${'a'.repeat(30)}\n+${'b'.repeat(30)}\n`
  const head = '--- a/x\n+++ b/x\n'
  const text = head + hunk(1) + hunk(2) + hunk(3)
  expect(capDiff(text, 10_000)).toEqual({ text, isCut: false })
  const cut = capDiff(text, head.length + hunk(1).length + 20)
  expect(cut).toEqual({ text: head + hunk(1), isCut: true })
  const one = capDiff(head + hunk(1), head.length + 30)
  expect(one.isCut).toBe(true)
  expect(one.text.endsWith('\n')).toBe(true)
  expect(one.text.length).toBeLessThanOrEqual(head.length + 30)
})

test('capDiff: a first hunk over the limit is cut at a line with its header counts rewritten to the lines kept', () => {
  const body = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join('\n')
  const added = `--- /dev/null\n+++ b/a\n@@ -0,0 +1,50 @@\n${body}\n`
  const cut = capDiff(added, 120)
  expect(cut.isCut).toBe(true)
  const lines = cut.text.split('\n')
  lines.pop()
  const kept = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length
  expect(kept).toBeGreaterThan(0)
  expect(kept).toBeLessThan(50)
  expect(lines[2]).toBe(`@@ -0,0 +1,${kept} @@`)

  const mixed = '--- a/x\n+++ b/x\n@@ -1,5 +1,5 @@\n ctx one\n-old one\n+new one\n ctx two\n-old two\n+new two\n'
  const two = capDiff(mixed, 60)
  expect(two).toEqual({ text: '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n ctx one\n-old one\n+new one\n', isCut: true })
})

test('additionsDiff: a whole file as one hunk of added lines', () => {
  expect(additionsDiff('notes.md', 'one\r\ntwo\n')).toBe('--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1,2 @@\n+one\n+two\n')
  expect(additionsDiff('a', 'x')).toBe('--- /dev/null\n+++ b/a\n@@ -0,0 +1,1 @@\n+x\n')
  expect(additionsDiff('empty', '')).toBe('')
})

test('parsePerimeter: the entries of an active perimeter on the branch checked out, else nothing', () => {
  const file = 'branch: feat/x\r\nstatus: active\r\n- src/a.ts\r\n- src/b/\r\n-   \r\nnote\r\n'
  expect(parsePerimeter(file, 'feat/x')).toEqual(['src/a.ts', 'src/b/'])
  expect(parsePerimeter(file, 'feat/y')).toBeUndefined()
  expect(parsePerimeter(file.replace('active', 'closed'), 'feat/x')).toBeUndefined()
  expect(parsePerimeter('branch: feat/x\nstatus: active\n', 'feat/x')).toBeUndefined()
  expect(parsePerimeter('{}', 'feat/x')).toBeUndefined()
})

test('parseDefaultBranch: the branch origin/HEAD points at, without the remote', () => {
  expect(parseDefaultBranch('origin/main\n')).toBe('main')
  expect(parseDefaultBranch('origin/release/2026\n')).toBe('release/2026')
  expect(parseDefaultBranch('')).toBeUndefined()
  expect(parseDefaultBranch('upstream/main')).toBeUndefined()
})

test('isGithubRemote: ssh and https URLs of github.com, nothing else', () => {
  const SSH_USER = 'git' // the user part, kept apart so the URLs below are not read as e-mail addresses
  expect(isGithubRemote(`${SSH_USER}@github.com:example/orders.git\n`)).toBe(true)
  expect(isGithubRemote('https://github.com/example/orders')).toBe(true)
  expect(isGithubRemote(`https://${SSH_USER}@github.com/example/orders.git`)).toBe(true)
  expect(isGithubRemote(`ssh://${SSH_USER}@github.com/example/orders.git`)).toBe(true)
  expect(isGithubRemote('https://dev.azure.com/<org>/proj/_git/orders')).toBe(false)
  expect(isGithubRemote(`${SSH_USER}@ssh.dev.azure.com:v3/<org>/proj/orders`)).toBe(false)
  expect(isGithubRemote('https://notgithub.com/example/orders')).toBe(false)
  expect(isGithubRemote('')).toBe(false)
})

// ── Lavoro: the deliver perimeter check and the done-claim log ──

test('checkPerimeter: the changed files no entry covers, as scope-guard --check lists them', () => {
  const entries = ['src/a.ts', 'src/b/', 'tests/**/Orders*.cs']
  const changed = ['src/a.ts', 'src/b/x/y.ts', 'tests/unit/OrdersTests.cs', 'SRC/A.ts', 'src/c.ts', 'README.md', 'docs/plans/x.md', '.git/config', 'src/c.ts']
  // case-insensitive, a directory entry covers its subtree, docs/plans and .git are never outside, a path counts once
  expect(checkPerimeter(changed, entries)).toEqual({ files: 8, outside: ['src/c.ts', 'README.md'] })
  expect(checkPerimeter([], entries)).toEqual({ files: 0, outside: [] })
  expect(checkPerimeter(['a\\b.ts'], ['a/b.ts'])).toEqual({ files: 1, outside: [] })
})

test('parseDoneClaims: the log lines that were blocks, newest first, with their session; a line without time or rule, and a rule that only counted, is skipped', () => {
  const line = (n: number, rule = 'unproven-row', session = 's') => JSON.stringify({ at: `2026-10-22T0${n}:00:00.000Z`, session, rule, word: 'fatto', excerpt: `claim ${n}` })
  const text = [line(1), 'not json', line(2, 'tail-cut'), JSON.stringify({ rule: 'x' }), line(3, 'shell-ran'), line(4, 'tail-truncated'), line(5, 'claim-without-evidence', 'other'), ''].join('\n')
  expect(parseDoneClaims(text, 's').map(c => c.excerpt)).toEqual(['claim 2', 'claim 1'])
  expect(parseDoneClaims(text, 's')[0]).toEqual({ at: '2026-10-22T02:00:00.000Z', session: 's', rule: 'tail-cut', excerpt: 'claim 2' })
  expect(parseDoneClaims(text, 'other').map(c => c.excerpt)).toEqual(['claim 5'])
  expect(parseDoneClaims(text, undefined)).toEqual([])
  expect(parseDoneClaims('', 's')).toEqual([])
  expect(parseDoneClaims('{}', 's')).toEqual([])
})

test('parseDoneClaims: the session is filtered before the last entries are kept, so a busy other session cannot push its blocks out', () => {
  const line = (n: number, session: string) => JSON.stringify({ at: new Date(2026, 9, 22, 8, n).toISOString(), session, rule: 'unproven-row', excerpt: `${session} ${n}` })
  const text = [line(1, 'mine'), line(2, 'mine'), ...Array.from({ length: 40 }, (_, i) => line(3 + i, 'busy'))].join('\n')
  expect(parseDoneClaims(text, 'mine').map(c => c.excerpt)).toEqual(['mine 2', 'mine 1'])
  expect(parseDoneClaims(text, 'busy')).toHaveLength(30)
})

test('claimsOf: the last three blocks of the session, newest first; none without a session', () => {
  const claim = (at: string, session?: string) => ({ at, ...(session && { session }), rule: 'unproven-row', excerpt: at })
  const list = [claim('5', 'b'), claim('4', 'a'), claim('3'), claim('2', 'a'), claim('1', 'a'), claim('0', 'a')]
  expect(claimsOf(list, 'a').map(c => c.at)).toEqual(['4', '2', '1'])
  expect(claimsOf(list, 'c')).toEqual([])
  expect(claimsOf(list, undefined)).toEqual([])
  expect(claimsOf(undefined, 'a')).toEqual([])
})

test('claimTime: day/month and hour:minute of the log entry, in the local clock', () => {
  expect(claimTime(new Date(2026, 9, 22, 9, 5).toISOString())).toBe('22/10 09:05')
  expect(claimTime('garbage')).toBe('')
})

test('aheadBehindSpans: the commits ahead and behind the upstream, nothing when level or without one', () => {
  const git = { branch: 'x', staged: 0, modified: 0, untracked: 0 }
  expect(spanText(aheadBehindSpans({ ...git, upstream: 'origin/x', ahead: 2, behind: 1 }))).toBe(' ↑2 ↓1')
  expect(spanText(aheadBehindSpans({ ...git, upstream: 'origin/x', ahead: 3, behind: 0 }))).toBe(' ↑3')
  expect(aheadBehindSpans({ ...git, upstream: 'origin/x', ahead: 0, behind: 0 })).toEqual([])
  expect(aheadBehindSpans(git)).toEqual([])
})

test('parseCreatedPr: the pull request a gh or az create printed, with the title the command gave; nothing for any other command or output', () => {
  const GH = 'https://github.com/example/orders/pull/42'
  expect(parseCreatedPr('gh pr create --title "Add filter" --body "x"', `Creating...\n${GH}\n`)).toEqual({ number: 42, title: 'Add filter', state: 'open', isDraft: false, url: GH })
  expect(parseCreatedPr("gh pr create -t 'Add filter' --draft", GH)).toEqual({ number: 42, title: 'Add filter', state: 'open', isDraft: true, url: GH })
  expect(parseCreatedPr('gh pr create --fill', GH)?.title).toBe('')
  expect(parseCreatedPr('gh pr create --title "x"', 'no url here')).toBeUndefined()
  expect(parseCreatedPr('gh pr view --title "x"', GH)).toBeUndefined()
  const az = JSON.stringify({ pullRequestId: 9, title: 'Faster', status: 'active', isDraft: false, repository: { webUrl: 'https://dev.azure.com/o/p/_git/r' } })
  expect(parseCreatedPr('az repos pr create --title Faster --source-branch x', az)).toEqual({
    number: 9,
    title: 'Faster',
    state: 'open',
    isDraft: false,
    url: 'https://dev.azure.com/o/p/_git/r/pullrequest/9',
  })
  expect(parseCreatedPr('az repos pr create', JSON.stringify({ pullRequestId: 9, title: 'No web url' }))).toEqual({ number: 9, title: 'No web url', state: 'open', isDraft: false })
  expect(parseCreatedPr('az repos pr create', 'ERROR: failed')).toBeUndefined()
  expect(parseCreatedPr('git status', az)).toBeUndefined()
})

test('upsertPr: a PR seen again replaces its entry in place (by url, else by number); the list keeps the last ten', () => {
  const pr = (number: number, extra: object = {}) => ({ number, title: `t${number}`, state: 'open' as const, isDraft: false, ...extra })
  const first = upsertPr(undefined, pr(1, { url: 'u/1' }))
  const two = upsertPr(first, pr(2))
  expect(upsertPr(two, pr(1, { url: 'u/1', state: 'merged' })).map(p => `${p.number}:${p.state}`)).toEqual(['1:merged', '2:open'])
  // a read without a url still finds the entry that has one
  expect(upsertPr(two, pr(1, { state: 'closed' })).map(p => `${p.number}:${p.state}`)).toEqual(['1:closed', '2:open'])
  // the same number under another url is another PR
  expect(upsertPr(two, pr(1, { url: 'other/1' }))).toHaveLength(3)
  let list = first
  for (let n = 2; n <= 12; n++) list = upsertPr(list, pr(n))
  expect(list.map(p => p.number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
})

test('parseSavedPrs: the entries of a state file that have a number and a title, any state; none for anything else', () => {
  const ok = { number: 7, title: 'Old', state: 'merged', isDraft: false, url: 'https://github.com/example/orders/pull/7', review: 'approved', checks: { passed: 1, failed: 0, pending: 0 } }
  expect(parseSavedPrs([ok, { number: 'x', title: 't' }, { title: 'no number' }, null, 5])).toEqual([ok])
  expect(parseSavedPrs([{ number: 8, title: 't' }])).toEqual([{ number: 8, title: 't', state: 'open', isDraft: false }])
  expect(parseSavedPrs('nope')).toEqual([])
  expect(parseSavedPrs(undefined)).toEqual([])
})

// ── Cockpit v3, phase 5: the Sistema tab, and the phase 4 follow-ups ──

test('safeUrl: only an http(s) address without control characters; anything else is none', () => {
  expect(safeUrl('https://github.com/example/orders/pull/42')).toBe('https://github.com/example/orders/pull/42')
  expect(safeUrl('HTTP://localhost:3000/x')).toBe('HTTP://localhost:3000/x')
  expect(safeUrl('javascript:alert(1)')).toBeUndefined()
  expect(safeUrl('file:///etc/passwd')).toBeUndefined()
  expect(safeUrl('https://')).toBeUndefined()
  expect(safeUrl('https://example.org/a\u001b]8;;x')).toBeUndefined()
  expect(safeUrl('https://example.org/a\nb')).toBeUndefined()
  expect(safeUrl('https://example.org/a\u007f')).toBeUndefined()
  expect(safeUrl('https://example.org/a\u009b')).toBeUndefined()
  expect(safeUrl('')).toBeUndefined()
  expect(safeUrl(42)).toBeUndefined()
  expect(safeUrl(undefined)).toBeUndefined()
})

test('safeUrl: every source of a PR address goes through it (gh url, az webUrl, gh create output, saved state)', () => {
  const gh = (url: string) => parseGithubPr(JSON.stringify({ number: 1, state: 'OPEN', title: 't', url }))
  expect(gh('https://github.com/example/orders/pull/1')?.url).toBe('https://github.com/example/orders/pull/1')
  expect(gh('javascript:alert(1)')?.number).toBe(1)
  expect(gh('javascript:alert(1)')?.url).toBeUndefined()
  const az = (webUrl: string) => parseAzurePr(JSON.stringify([{ pullRequestId: 7, status: 'active', repository: { webUrl } }]))
  expect(az('https://dev.azure.com/o/p/_git/r')?.url).toBe('https://dev.azure.com/o/p/_git/r/pullrequest/7')
  expect(az('javascript:alert(1)')?.url).toBeUndefined()
  expect(az('ftp://host/r')?.url).toBeUndefined()
  // a refused address costs the link, never the pull request
  expect(az('javascript:alert(1)')?.number).toBe(7)
  expect(az('ftp://host/r')?.number).toBe(7)
  const created = parseCreatedPr('gh pr create --title T', 'https://github.com/a\u001b/b/pull/42')
  expect(created?.number).toBe(42)
  expect(created?.url).toBeUndefined()
  const azCreated = parseCreatedPr('az repos pr create', JSON.stringify({ pullRequestId: 9, repository: { webUrl: 'javascript:x' } }))
  expect(azCreated?.number).toBe(9)
  expect(azCreated?.url).toBeUndefined()
  const saved = parseSavedPrs([{ number: 3, title: 't', url: 'javascript:alert(1)' }, { number: 4, title: 't', url: 'https://example.org/pr/4' }])
  expect(saved.map(p => p.url)).toEqual([undefined, 'https://example.org/pr/4'])
})

test('parseCreatedPr: the title and draft flags are read only from the create command, not from the rest of a compound command', () => {
  const out = 'https://github.com/example/orders/pull/42\n'
  const title = (command: string) => parseCreatedPr(command, out)?.title
  const draft = (command: string) => parseCreatedPr(command, out)?.isDraft
  expect(title('echo --title "Wrong" && gh pr create --title "Right"')).toBe('Right')
  expect(title('gh pr create --fill && git log -t nope --title other')).toBe('')
  expect(title('gh pr create --fill; echo -t nope')).toBe('')
  expect(title('gh pr create -t Short | tee log')).toBe('Short')
  expect(draft('docker run -d x && gh pr create --title T')).toBe(false)
  expect(draft('gh pr create --title T && git branch -d old')).toBe(false)
  expect(draft('git fetch -d || gh pr create --fill')).toBe(false)
  expect(draft('gh pr create --title T --draft')).toBe(true)
  expect(draft('cd repo\ngh pr create -d --title T')).toBe(true)
  // an operator inside a quoted title does not end the command
  expect(title('gh pr create --title "a && b" --draft')).toBe('a && b')
  expect(draft('gh pr create --title "a && b" --draft')).toBe(true)
  expect(title("gh pr create --title 'x; y' --body z")).toBe('x; y')
})

test('parseCreatedPr: a -t or -d inside a quoted argument is text, not a flag', () => {
  const out = 'https://github.com/example/orders/pull/42\n'
  const title = (command: string) => parseCreatedPr(command, out)?.title
  const draft = (command: string) => parseCreatedPr(command, out)?.isDraft
  expect(title('gh pr create --body "fix -t nope" --title Right')).toBe('Right')
  expect(title("gh pr create --body 'see -t nope' --fill")).toBe('')
  expect(draft('gh pr create --title T --body "use -d for a draft"')).toBe(false)
  expect(draft("gh pr create --title T --body 'x -d'")).toBe(false)
  expect(draft('gh pr create --title T --body "x" -d')).toBe(true)
  expect(title('gh pr create --title="a -t b" --draft')).toBe('a -t b')
  expect(title('gh pr create -t "a -d b"')).toBe('a -d b')
  expect(draft('gh pr create -t "a -d b"')).toBe(false)
})

test('parseCommits: hash and subject per line, newest first; a line without a tab or a subject is skipped', () => {
  expect(parseCommits('abc1234\tAdd the filter\ndef5678\tFix: a\tb\nnotab\n\n9999999\t \n')).toEqual([
    { hash: 'abc1234', subject: 'Add the filter' },
    { hash: 'def5678', subject: 'Fix: a\tb' },
  ])
  expect(parseCommits('')).toEqual([])
})

test('editedPathOf / recordEdited / repoRelative / parseEdited: the files an edit call writes, once each, made relative to the checkout', () => {
  expect(editedPathOf({ tool: 'Edit', file_path: '/w/a.ts' })).toBe('/w/a.ts')
  expect(editedPathOf({ tool: 'Write', file_path: ['', 'w', 'b.ts'].join(String.fromCharCode(92)) })).toBe('/w/b.ts')
  expect(editedPathOf({ tool: 'MultiEdit', file_path: '/w/c.ts' })).toBe('/w/c.ts')
  expect(editedPathOf({ tool: 'NotebookEdit', notebook_path: '/w/n.ipynb' })).toBe('/w/n.ipynb')
  expect(editedPathOf({ tool: 'Read', file_path: '/w/a.ts' })).toBeUndefined()
  expect(editedPathOf({ tool: 'Edit', file_path: '' })).toBeUndefined()
  expect(recordEdited(recordEdited(undefined, '/w/a.ts'), '/w/a.ts')).toEqual(['/w/a.ts'])
  expect(recordEdited(Array.from({ length: 200 }, (_, i) => `/f${i}`), '/new').at(-1)).toBe('/new')
  expect(recordEdited(Array.from({ length: 200 }, (_, i) => `/f${i}`), '/new')).toHaveLength(200)
  expect(repoRelative('/w/repo', '/w/repo/src/a.ts')).toBe('src/a.ts')
  expect(repoRelative('/w/repo/', '/w/repo/src/a.ts')).toBe('src/a.ts')
  expect(repoRelative('/W/Repo', '/w/repo/src/a.ts')).toBe('src/a.ts')
  expect(repoRelative('/w/repo', '/w/repo2/a.ts')).toBeUndefined()
  expect(repoRelative(undefined, '/w/repo/a.ts')).toBeUndefined()
  expect(parseEdited(['/a', 7, '', '/b'])).toEqual(['/a', '/b'])
  expect(parseEdited('x')).toBeUndefined()
  expect(parseEdited([])).toBeUndefined()
})
