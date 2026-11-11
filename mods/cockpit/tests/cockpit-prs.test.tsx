import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { GH_CREATED, MIN, bashResult, fileOfSession, mountPane, openCockpit, settleAll } from './cockpit-fixtures'
import { GH_SSH, NOW, dataOf, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

// The chat's pull requests are read in the background (gh for a GitHub remote, az for Azure DevOps) and kept in the session's data file.

const GH_PR_ARGS = 'gh pr view --json number,title,url,state,isDraft,createdAt'
const AZ_REMOTE = 'https://dev.azure.com/<org>/proj/_git/orders'
const AZ_WORKSPACES = { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] }
const AZ_PR = [{ pullRequestId: 7, title: 'Faster orders', status: 'active' }]
const AZ_LIST = `repos pr list --organization ${['https://dev.azure.com', 'org-a'].join('/')} --project proj --repository orders --source-branch refs/heads/feature/orders-filter --status all --top 1 --output json`
const FIX = { number: 42, title: 'Fix the orders filter' }

type Saved = { number: number; title: string; state?: string; url?: string }

/** A session in a world that records its writes: the clock, the writes and the options (mutable: the world reads them at every call). */
async function chat($: Engine, on: On, options: World = {}, hooks: (on: On) => void = () => {}) {
  const writes = new Map<string, string>()
  options.writes = writes
  const clock = world(on, options)
  hooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  return { writes, clock }
}

/** The pull requests the data file holds once its write has landed; call it once, last (it moves the clock 3 s). */
async function saved(clock: Awaited<ReturnType<typeof chat>>['clock'], writes: Map<string, string>): Promise<Saved[]> {
  await clock.advance(3000)
  await settleAll()
  return (dataOf(writes)?.prs ?? []) as Saved[]
}

test('PR: a GitHub pull request of the branch is kept: number, title and address (gh pr view, once)', async ($, on) => {
  const ghCalls: string[] = []
  const { clock, writes } = await chat($, on, { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prExtra: { url: GH_CREATED } })
  expect(ghCalls).toEqual([GH_PR_ARGS])
  expect(await saved(clock, writes)).toEqual([expect.objectContaining({ ...FIX, url: GH_CREATED })])
})

test("PR: the branch's pull request opened before the chat began is not the chat's", async ($, on) => {
  const { clock, writes } = await chat($, on, { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prExtra: { url: GH_CREATED, createdAt: new Date(NOW - 60_000).toISOString() } })
  expect(await saved(clock, writes)).toEqual([])
})

test("PR: the branch's pull request without an opening date is not taken as the chat's", async ($, on) => {
  const { clock, writes } = await chat($, on, { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prExtra: { url: GH_CREATED, createdAt: undefined } })
  expect(await saved(clock, writes)).toEqual([])
})

test('PR: a pull request the chat already holds stays kept, whenever it was opened', async ($, on) => {
  const dataFile = JSON.stringify({ history: [], prs: [{ number: 42, title: 'Fix the orders filter', state: 'open' }] })
  const { clock, writes } = await chat($, on, { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prExtra: { url: GH_CREATED, createdAt: new Date(NOW - 86_400_000).toISOString() }, dataFile })
  expect((await saved(clock, writes)).map(p => p.number)).toEqual([42])
})

test('PR: a resumed chat keeps the moment it began, so a pull request opened before the resume is still its own', async ($, on) => {
  const dataFile = JSON.stringify({ history: [], startedAt: NOW - 2 * 60 * MIN })
  const { clock, writes } = await chat($, on, { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prExtra: { url: GH_CREATED, createdAt: new Date(NOW - 60 * MIN).toISOString() }, dataFile })
  expect((await saved(clock, writes)).map(p => p.number)).toEqual([42])
  expect(dataOf(writes)?.startedAt).toBe(NOW - 2 * 60 * MIN)
})

test("PR: a pull request opened seconds before the chat began, by a server clock behind this one, is still the chat's", async ($, on) => {
  const { clock, writes } = await chat($, on, { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prExtra: { url: GH_CREATED, createdAt: new Date(NOW - 5_000).toISOString() } })
  expect((await saved(clock, writes)).map(p => p.number)).toEqual([42])
})

test("PR: on Azure DevOps the branch's pull request opened before the chat began is not the chat's", async ($, on) => {
  const azPr = [{ pullRequestId: 7, title: 'Faster orders', status: 'active', creationDate: new Date(NOW - 60 * MIN).toISOString() }]
  const { clock, writes } = await chat($, on, { branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr })
  expect(await saved(clock, writes)).toEqual([])
})

test('PR: a work item id in the branch name does not keep gh from being asked', async ($, on) => {
  const ghCalls: string[] = []
  const { clock, writes } = await chat($, on, { ghCalls, branch: 'feature/AB#77-orders', remote: 'https://github.com/example/orders', pr: 42 })
  expect((await saved(clock, writes)).map(p => p.number)).toEqual([42])
  expect(ghCalls).toEqual([GH_PR_ARGS])
})

// `isGhAsked`: whether `gh pr view` is run at all (only for a GitHub remote)
for (const { name, options, isGhAsked } of [
  { name: 'an unknown remote', options: { remote: 'https://git.example.org/orders.git', pr: 42 }, isGhAsked: false },
  { name: 'no remote', options: { pr: 42 }, isGhAsked: false },
  { name: 'gh not installed', options: { remote: GH_SSH, pr: 42, noGh: true }, isGhAsked: true },
  { name: 'no PR for the branch', options: { remote: GH_SSH }, isGhAsked: true },
] as const) {
  test(`PR: with ${name} none is kept`, async ($, on) => {
    const ghCalls: string[] = []
    const { clock, writes } = await chat($, on, { ghCalls, branch: 'feature/orders-filter', ...options })
    expect(ghCalls).toEqual(isGhAsked ? [GH_PR_ARGS] : [])
    expect(await saved(clock, writes)).toEqual([])
  })
}

test('PR: an Azure DevOps remote asks az repos pr list with the org of the ALM line and the project of the remote', async ($, on) => {
  const azCalls: string[] = []
  const ghCalls: string[] = []
  const azPr = [{ pullRequestId: 7, title: 'Faster orders', status: 'active', isDraft: false, reviewers: [{ vote: 10 }, { vote: 0 }] }]
  const { clock, writes } = await chat($, on, { azCalls, ghCalls, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr })
  // the org is the ALM line's, as a URL (joined, so the text is not read as a real organization's)
  expect(azCalls).toHaveLength(1)
  expect(azCalls[0]).toContain(AZ_LIST)
  expect(ghCalls).toEqual([])
  expect(await saved(clock, writes)).toEqual([expect.objectContaining({ number: 7, title: 'Faster orders', state: 'open' })])
})

test('PR: on Azure DevOps the repository is asked in the project of the remote URL, not the ALM one', async ($, on) => {
  const azCalls: string[] = []
  const { clock, writes } = await chat($, on, { azCalls, branch: 'feature/orders-filter', remote: 'https://dev.azure.com/<org>/Beta/_git/orders', workspaces: AZ_WORKSPACES, azPr: AZ_PR })
  expect(azCalls).toHaveLength(1)
  expect(azCalls[0]).toContain('--project Beta --repository orders')
  expect((await saved(clock, writes)).map(p => p.number)).toEqual([7])
})

for (const { name, options, workspaces } of [
  { name: 'az not installed', options: { noAz: true }, workspaces: AZ_WORKSPACES },
  { name: 'no PR on the branch', options: { azPr: [] }, workspaces: AZ_WORKSPACES },
  { name: 'a list without a usable PR', options: { azPr: [{ title: 'x' }] }, workspaces: AZ_WORKSPACES },
  { name: 'no ALM org to ask', options: { azPr: [{ pullRequestId: 7, title: 'x', status: 'active' }] }, workspaces: { roots: [] } },
] as const) {
  test(`PR: on Azure DevOps with ${name} none is kept`, async ($, on) => {
    const azCalls: string[] = []
    const { clock, writes } = await chat($, on, { azCalls, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces, ...options })
    // without an org the CLI is not asked at all: never the configured default
    expect(azCalls.length).toBe(name === 'no ALM org to ask' ? 0 : 1)
    expect(await saved(clock, writes)).toEqual([])
  })
}

test('PR: read at most every 5 minutes, and again for another branch; the default branch is never asked', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const { clock, writes } = await chat($, on, options)
  expect(ghCalls).toHaveLength(1)
  for (let i = 0; i < 4; i++) await clock.advance(30_000) // four ticks, a minute: no new read
  await settleAll()
  expect(ghCalls).toHaveLength(1)
  await openCockpit($)
  await clock.advance(5 * MIN)
  await settleAll()
  expect(ghCalls).toHaveLength(2)

  options.branch = 'feature/other' // another branch is another question, asked at the next tick
  options.pr = 43
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(4) // the other branch's PR, and #42 of the branch left behind, read again by its number

  options.branch = 'main'
  await clock.advance(30_000)
  await settleAll()
  // no branch read for main; the two saved PRs are read again by number
  expect(ghCalls.filter(c => c === GH_PR_ARGS)).toHaveLength(3)
  expect(ghCalls).toHaveLength(6)
  // the PR of the branch left behind stays kept: it is the chat's
  expect((await saved(clock, writes)).map(p => p.number).sort()).toEqual([42, 43])
})

test('PR: the PR of a branch left behind stays kept on the next one, which adds none of its own', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const { clock, writes } = await chat($, on, options)
  options.branch = 'feature/other'
  options.pr = undefined
  await clock.advance(30_000)
  await settleAll()
  expect((await saved(clock, writes)).map(p => p.number)).toEqual([42])
})

test('PR: a repo the chat only passes through (a cd to read) adds no PR; once the chat edits a file there, its PR is read', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, cwd: '/work/home', notRepo: true, remote: GH_SSH, pr: 42 }
  const { clock, writes } = await chat($, on, options, on => on('tool.call', () => ({ result: {} })))
  await openCockpit($)
  options.cwd = '/work/other-repo'
  options.notRepo = false
  options.branch = 'feature/someone-else'
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toEqual([])

  await $.tool.call({ tool: 'Edit', file_path: '/work/other-repo/src/a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toEqual([GH_PR_ARGS])
  expect((await saved(clock, writes)).map(p => p.number)).toEqual([42])
})

test('PR: the repo the process started in is the chat\'s, its case aside; an edit in a third repo does not make the one passed through the chat\'s', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, cwd: '/Work/Home', remote: GH_SSH, pr: 42 }
  const { clock } = await chat($, on, options, on => on('tool.call', () => ({ result: {} })))
  expect(ghCalls).toEqual([GH_PR_ARGS])
  await openCockpit($)
  options.cwd = '/Work/other-repo'
  options.branch = 'feature/someone-else'
  await $.tool.call({ tool: 'Edit', file_path: '/Work/third/x.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(1)

  options.cwd = '/work/home'
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(2)
})

test('PR: a detached HEAD or a folder without git forgets the PR read, so the branch is asked again on return', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const { clock } = await chat($, on, options)
  expect(ghCalls).toHaveLength(1)

  options.detached = true
  await openCockpit($)
  await clock.advance(30_000)
  options.detached = false
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(2)

  options.notRepo = true
  await clock.advance(30_000)
  options.notRepo = false
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(3)
})

test('PR: a branch left and come back to is asked again, not served from the read of five minutes ago', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const { clock } = await chat($, on, options)
  options.branch = 'feature/other'
  await openCockpit($)
  await clock.advance(30_000)
  await settleAll()
  options.branch = 'feature/orders-filter'
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(3)
})

test('PR: a failed gh pr view adds nothing and leaves the PRs already kept', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const { clock, writes } = await chat($, on, options)
  options.noGh = true // gh is gone: the next read fails
  await clock.advance(5 * MIN)
  await settleAll()
  expect((await saved(clock, writes)).map(p => p.number)).toEqual([42])
})

test('PR: a branch that changes between a refresh\'s git read and its patch is asked again, not served from the read of the branch it left', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const { clock, writes } = await chat($, on, options)
  expect(ghCalls).toHaveLength(1)

  // A refresh reads the branch, then waits; meanwhile another one finds HEAD detached and patches that in.
  let release = () => {}
  options.holdRevParse = new Promise<void>(resolve => {
    release = resolve
  })
  await openCockpit($)
  await clock.advance(30_000)
  await settleAll()
  options.detached = true
  await clock.advance(30_000)
  await settleAll()
  options.detached = false
  release() // the first refresh patches the branch it read, over the one the snapshot now holds
  await settleAll()
  expect(ghCalls).toHaveLength(2)
  expect((await saved(clock, writes)).map(p => p.number)).toEqual([42])
})

// ── The Azure CLI is started the way the platform can start it, aimed at the identity's own config ──

for (const { name, env } of [
  { name: 'OS is Windows_NT', env: { OS: 'Windows_NT' } },
  { name: 'ComSpec is set', env: { ComSpec: 'cmd.exe' } },
]) {
  test(`az: on Windows (${name}) it runs through cmd, since az.cmd cannot be started by name without a shell`, async ($, on) => {
    const azCalls: string[] = []
    const { clock, writes } = await chat($, on, { azCalls, env: { CLAUDE_CONFIG_DIR: '/cfg', ...env }, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
    expect(azCalls).toEqual([`cmd /d /s /c az ${AZ_LIST}`])
    expect((await saved(clock, writes)).map(p => p.number)).toEqual([7])
  })
}

test('az: elsewhere it is started by name, with no shell in between', async ($, on) => {
  const azCalls: string[] = []
  await chat($, on, { azCalls, env: { CLAUDE_CONFIG_DIR: '/cfg', OS: 'Linux' }, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
  expect(azCalls).toEqual([`az ${AZ_LIST}`])
})

test('az: on Windows an argument cmd would read as more than text (a branch named a&b) is never handed to it', async ($, on) => {
  const azCalls: string[] = []
  const { clock, writes } = await chat($, on, { azCalls, env: { CLAUDE_CONFIG_DIR: '/cfg', OS: 'Windows_NT' }, branch: 'feature/a&b', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
  expect(azCalls).toEqual([])
  expect(await saved(clock, writes)).toEqual([])
})

for (const { name, env, prefix } of [
  { name: 'elsewhere', env: { HOME: '/home/me' }, prefix: 'az ' },
  { name: 'on Windows', env: { OS: 'Windows_NT', USERPROFILE: '/home/me' }, prefix: 'cmd /d /s /c az ' },
]) {
  test(`az: ${name} the ALM identity's own config folder is selected for the call, when that folder exists`, async ($, on) => {
    const azCalls: string[] = []
    const azEnvs: (Record<string, string> | undefined)[] = []
    await chat($, on, { azCalls, azEnvs, azDirs: ['.azure-id-a'], env: { CLAUDE_CONFIG_DIR: '/cfg', ...env }, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
    expect(azCalls).toHaveLength(1)
    expect(azCalls[0]?.startsWith(prefix)).toBe(true)
    expect(azEnvs).toEqual([{ AZURE_CONFIG_DIR: `${(env as Record<string, string>).USERPROFILE ?? (env as Record<string, string>).HOME}/.azure-id-a` }])
  })
}

test('az: an identity whose config folder does not exist leaves the call with no AZURE_CONFIG_DIR, as hooks/lib/az-pin.js does', async ($, on) => {
  const azEnvs: (Record<string, string> | undefined)[] = []
  await chat($, on, { azEnvs, azDirs: [], env: { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/me' }, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
  expect(azEnvs).toEqual([undefined])
})

// ── A PR the chat creates ──

test('PR: one created in the session (gh pr create) is kept in the data file and logged in DONE', async ($, on) => {
  const { clock, writes } = await chat($, on, {}, on => on('tool.call', { tool: 'Bash' }, () => bashResult(`Creating pull request\n${GH_CREATED}\n`)))
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add filter" --body "x"' })
  await $.tool.call({ tool: 'Bash', command: 'git status' }) // not a create: nothing
  const ui = await mountPane($)
  expect(rowTexts(await ui.drawn()).some(r => /^\d\d:\d\d ◆ PR #42 Add filter/.test(r))).toBe(true)
  await ui.unmount()
  expect(await saved(clock, writes)).toEqual([{ number: 42, title: 'Add filter', url: GH_CREATED }])
})

test('PR: one created with az repos pr create takes its link from the repository web url', async ($, on) => {
  const answer = bashResult(JSON.stringify({ pullRequestId: 9, title: 'Faster orders', status: 'active', isDraft: true, repository: { webUrl: 'https://dev.azure.com/o/p/_git/r' } }))
  const { clock, writes } = await chat($, on, {}, on => on('tool.call', { tool: 'Bash' }, () => answer))
  await $.tool.call({ tool: 'Bash', command: 'az repos pr create --title "Faster orders" --draft true' })
  expect(await saved(clock, writes)).toEqual([expect.objectContaining({ number: 9, title: 'Faster orders', url: 'https://dev.azure.com/o/p/_git/r/pullrequest/9' })])
})

test('PR: one created in the chat is read again by its address, and moves to merged; an ended one is not read again', async ($, on) => {
  const ghCalls: string[] = []
  const ghViews = { [GH_CREATED]: { number: 42, title: 'Add filter', url: GH_CREATED, state: 'MERGED', isDraft: false } }
  const { clock, writes } = await chat($, on, { ghCalls, remote: GH_SSH, ghViews }, on => on('tool.call', { tool: 'Bash' }, () => bashResult(`Creating pull request\n${GH_CREATED}\n`)))
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add filter" --body "x"' })
  await openCockpit($)
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toContain(`gh pr view ${GH_CREATED} --json number,title,url,state,isDraft`)
  await clock.advance(5 * MIN)
  await settleAll()
  expect(ghCalls.filter(c => c.includes(GH_CREATED))).toHaveLength(1)
  expect((await saved(clock, writes)).map(p => [p.number, p.state])).toEqual([[42, 'merged']])
})

test('PR: on Azure DevOps one created in the chat is read again with az repos pr show, aimed at the org of the ALM line', async ($, on) => {
  const azCalls: string[] = []
  const created = bashResult(JSON.stringify({ pullRequestId: 9, title: 'Faster orders', status: 'active', repository: { webUrl: 'https://dev.azure.com/o/p/_git/r' } }))
  const azShow = { 9: { pullRequestId: 9, title: 'Faster orders', status: 'abandoned' } }
  const { clock, writes } = await chat($, on, { azCalls, remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azShow }, on => on('tool.call', { tool: 'Bash' }, () => created))
  await $.tool.call({ tool: 'Bash', command: 'az repos pr create --title "Faster orders"' })
  await openCockpit($)
  await clock.advance(30_000)
  await settleAll()
  expect(azCalls.some(c => c.endsWith(`repos pr show --id 9 --organization ${['https://dev.azure.com', 'org-a'].join('/')} --output json`))).toBe(true)
  expect((await saved(clock, writes)).map(p => [p.number, p.state])).toEqual([[9, 'closed']])
})

test('PR: a saved one that cannot be read again keeps its last state', async ($, on) => {
  const { clock, writes } = await chat($, on, { remote: GH_SSH, ghViews: {} }, on => on('tool.call', { tool: 'Bash' }, () => bashResult(`${GH_CREATED}\n`)))
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add filter"' })
  await openCockpit($)
  await clock.advance(30_000)
  await settleAll()
  expect((await saved(clock, writes)).map(p => [p.number, p.state])).toEqual([[42, undefined]])
})

test('PR: a create that failed, was refused or printed no url adds no PR', async ($, on) => {
  let answer: { deny: string } | { result: object; isError?: true } = { deny: 'no' }
  const { clock, writes } = await chat($, on, {}, on => on('tool.call', { tool: 'Bash' }, () => answer))
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x' })
  answer = bashResult('error: could not create')
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x' })
  answer = { ...bashResult(GH_CREATED), isError: true }
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x' })
  expect(await saved(clock, writes)).toEqual([])
})

test('PR: the read of the branch updates a PR already kept (created, then read) instead of adding another', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH }
  const { clock, writes } = await chat($, on, options, on => on('tool.call', { tool: 'Bash' }, () => bashResult(GH_CREATED)))
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add filter"' })
  options.pr = 42
  options.prExtra = { url: GH_CREATED }
  await openCockpit($)
  await clock.advance(5 * MIN + 30_000)
  await settleAll()
  expect((await saved(clock, writes)).map(p => [p.number, p.title])).toEqual([[42, 'Fix the orders filter']])
})

test('PR: the pull requests of a session come back with it (the data file); the next session id starts with none', async ($, on) => {
  let id = 's-1'
  const prs = [{ number: 8, title: 'Checks', state: 'open' }]
  const writes = new Map<string, string>()
  const clock = world(on, { writes, sessionId: () => id, dataFile: JSON.stringify({ history: [], prs }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await saved(clock, writes)).map(p => p.number)).toEqual([8])
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(3000)
  await settleAll()
  expect((fileOfSession(writes, 's-2') as { prs?: unknown[] } | undefined)?.prs ?? []).toEqual([])
})
