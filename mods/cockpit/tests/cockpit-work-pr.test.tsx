import { expect, test } from 'claude-code/testing'

import { CHECKS, GH_CREATED, MIN, bashResult, lavoroRows, mountPane, settleAll, workRows } from './cockpit-fixtures'
import { GH_SSH, dataOf, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

const GH_PR_ARGS = 'gh pr view --json number,title,state,isDraft,reviewDecision,statusCheckRollup,url'
const AZ_REMOTE = 'https://dev.azure.com/<org>/proj/_git/orders'
const AZ_WORKSPACES = { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] }

test('PR: a GitHub pull request of the branch with its state, title, reviews and checks (gh pr view, once)', async ($, on) => {
  const ghCalls: string[] = []
  world(on, {
    ghCalls,
    branch: 'feature/orders-filter',
    remote: GH_SSH,
    pr: 42,
    prExtra: { isDraft: false, reviewDecision: 'APPROVED', statusCheckRollup: CHECKS },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const rows = await lavoroRows($)
  const i = rows.findIndex(r => r === 'PR · 1')
  expect(i).toBeGreaterThan(0)
  expect(rows[i - 1]).toBe(' ')
  expect(rows[i - 2]).toMatch(/^─+$/)
  expect(rows.slice(i + 1, i + 4)).toEqual([' ', '#42 · open · Fix the orders filter', '  review approved · checks 2/4 · ✗ 1 · ◐ 1'])
  expect(ghCalls).toEqual([GH_PR_ARGS])
})

test('PR: a work item id in the branch name no longer keeps gh from being asked', async ($, on) => {
  const ghCalls: string[] = []
  world(on, { ghCalls, branch: 'feature/AB#77-orders', remote: 'https://github.com/example/orders', pr: 42 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await lavoroRows($)).toContain('#42 · open · Fix the orders filter')
  expect(ghCalls).toEqual([GH_PR_ARGS])
})

// `isGhAsked`: whether `gh pr view` is run at all (only for a GitHub remote)
for (const { name, options, isGhAsked } of [
  { name: 'an unknown remote', options: { remote: 'https://git.example.org/orders.git', pr: 42 }, isGhAsked: false },
  { name: 'no remote', options: { pr: 42 }, isGhAsked: false },
  { name: 'gh not installed', options: { remote: GH_SSH, pr: 42, noGh: true }, isGhAsked: true },
  { name: 'no PR for the branch', options: { remote: GH_SSH }, isGhAsked: true },
] as const) {
  test(`PR: with ${name} Work draws no PR`, async ($, on) => {
    const ghCalls: string[] = []
    world(on, { ghCalls, branch: 'feature/orders-filter', ...options })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    expect((await lavoroRows($)).some(r => /^PR ·/.test(r))).toBe(false)
    expect(ghCalls).toEqual(isGhAsked ? [GH_PR_ARGS] : [])
  })
}

test('PR: a merged or closed PR of the branch is listed with its own state, not as an open one', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prState: 'MERGED' }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await lavoroRows($)).toContain('#42 · merged · Fix the orders filter')
  options.prState = 'CLOSED'
  await clock.advance(5 * MIN)
  await settleAll()
  const rows = await lavoroRows($)
  expect(rows).toContain('#42 · closed · Fix the orders filter')
  expect(rows.filter(r => /^#42 /.test(r))).toHaveLength(1)
})

test('PR: an Azure DevOps remote asks az repos pr list with the org of the ALM line and the project of the remote, and shows the review without inventing checks', async ($, on) => {
  const azCalls: string[] = []
  const ghCalls: string[] = []
  world(on, {
    azCalls,
    ghCalls,
    branch: 'feature/orders-filter',
    remote: AZ_REMOTE,
    workspaces: AZ_WORKSPACES,
    azPr: [{ pullRequestId: 7, title: 'Faster orders', status: 'active', isDraft: false, reviewers: [{ vote: 10 }, { vote: 0 }] }],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const rows = await lavoroRows($)
  const i = rows.findIndex(r => r === 'PR · 1')
  expect(i).toBeGreaterThan(0)
  expect(rows.slice(i + 1, i + 4)).toEqual([' ', '#7 · open · Faster orders', '  review approved'])
  expect(rows.some(r => /checks/.test(r))).toBe(false)
  expect(azCalls).toEqual([
    // the org is the ALM line's, as a URL (joined, so the text is not read as a real organization's)
    `az repos pr list --organization ${['https://dev.azure.com', 'org-a'].join('/')} --project proj --repository orders --source-branch refs/heads/feature/orders-filter --status all --top 1 --output json`,
  ])
  expect(ghCalls).toEqual([])
})

test('PR: on Azure DevOps the repository is asked in the project of the remote URL, not the ALM one', async ($, on) => {
  const azCalls: string[] = []
  world(on, {
    azCalls,
    branch: 'feature/orders-filter',
    remote: 'https://dev.azure.com/<org>/Beta/_git/orders',
    workspaces: AZ_WORKSPACES,
    azPr: [{ pullRequestId: 7, title: 'Faster orders', status: 'active' }],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect((await lavoroRows($)).some(r => r === '#7 · open · Faster orders')).toBe(true)
  expect(azCalls).toHaveLength(1)
  expect(azCalls[0]).toContain('--project Beta --repository orders')
})

for (const { name, options, workspaces } of [
  { name: 'az not installed', options: { noAz: true }, workspaces: AZ_WORKSPACES },
  { name: 'no PR on the branch', options: { azPr: [] }, workspaces: AZ_WORKSPACES },
  { name: 'a list without a usable PR', options: { azPr: [{ title: 'x' }] }, workspaces: AZ_WORKSPACES },
  { name: 'no ALM org to ask', options: { azPr: [{ pullRequestId: 7, title: 'x', status: 'active' }] }, workspaces: { roots: [] } },
] as const) {
  test(`PR: on Azure DevOps with ${name} Work draws no PR`, async ($, on) => {
    const azCalls: string[] = []
    world(on, { azCalls, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces, ...options })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    expect((await lavoroRows($)).some(r => /^PR ·/.test(r))).toBe(false)
    // without an org the CLI is not asked at all: never the configured default
    expect(azCalls.length).toBe(name === 'no ALM org to ask' ? 0 : 1)
  })
}

test('PR: read at most every 5 minutes, and again for another branch; the default branch is never asked', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(ghCalls).toHaveLength(1)
  for (let i = 0; i < 4; i++) await clock.advance(30_000) // four ticks, a minute: no new read
  await settleAll()
  expect(ghCalls).toHaveLength(1)
  await clock.advance(5 * MIN)
  await settleAll()
  expect(ghCalls).toHaveLength(2)

  options.branch = 'feature/other' // another branch is another question, asked at the next tick
  options.pr = 43
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(3)
  // the PR of the branch left behind stays listed: it is the chat's
  expect(await lavoroRows($)).toEqual(expect.arrayContaining(['#42 · open · Fix the orders filter', '#43 · open · Fix the orders filter']))

  options.branch = 'main'
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(3)
})

test('PR: the PR of a branch left behind stays listed on the next one, which adds none of its own', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await lavoroRows($)).toContain('#42 · open · Fix the orders filter')
  options.branch = 'feature/other'
  options.pr = undefined
  await clock.advance(30_000)
  await settleAll()
  const rows = await lavoroRows($)
  expect(rows).toContain('PR · 1')
  expect(rows).toContain('#42 · open · Fix the orders filter')
})

// ── PR read follow-ups ──

test('PR: a detached HEAD or a folder without git forgets the PR read, so the branch is asked again on return', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(ghCalls).toHaveLength(1)

  options.detached = true
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
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  options.branch = 'feature/other'
  await clock.advance(30_000)
  await settleAll()
  options.branch = 'feature/orders-filter'
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(3)
})

test('PR: a failed gh pr view adds nothing and leaves the PRs already listed', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await lavoroRows($)).toContain('#42 · open · Fix the orders filter')

  options.noGh = true // gh is gone: the next read fails
  await clock.advance(5 * MIN)
  await settleAll()
  expect(await lavoroRows($)).toContain('#42 · open · Fix the orders filter')
})

// ── The Azure CLI is started the way the platform can start it, aimed at the identity's own config ──

const AZ_PR = [{ pullRequestId: 7, title: 'Faster orders', status: 'active' }]
const AZ_LIST = `repos pr list --organization ${['https://dev.azure.com', 'org-a'].join('/')} --project proj --repository orders --source-branch refs/heads/feature/orders-filter --status all --top 1 --output json`

for (const { name, env } of [
  { name: 'OS is Windows_NT', env: { OS: 'Windows_NT' } },
  { name: 'ComSpec is set', env: { ComSpec: 'cmd.exe' } },
]) {
  test(`az: on Windows (${name}) it runs through cmd, since az.cmd cannot be started by name without a shell`, async ($, on) => {
    const azCalls: string[] = []
    world(on, { azCalls, env: { CLAUDE_CONFIG_DIR: '/cfg', ...env }, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    expect(azCalls).toEqual([`cmd /d /s /c az ${AZ_LIST}`])
    expect((await lavoroRows($)).some(r => r === '#7 · open · Faster orders')).toBe(true)
  })
}

test('az: elsewhere it is started by name, with no shell in between', async ($, on) => {
  const azCalls: string[] = []
  world(on, { azCalls, env: { CLAUDE_CONFIG_DIR: '/cfg', OS: 'Linux' }, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(azCalls).toEqual([`az ${AZ_LIST}`])
})

test('az: on Windows an argument cmd would read as more than text (a branch named a&b) is never handed to it', async ($, on) => {
  const windows: string[] = []
  world(on, { azCalls: windows, env: { CLAUDE_CONFIG_DIR: '/cfg', OS: 'Windows_NT' }, branch: 'feature/a&b', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(windows).toEqual([])
  expect((await lavoroRows($)).some(r => /^PR ·/.test(r))).toBe(false)
})

for (const { name, env, prefix } of [
  { name: 'elsewhere', env: { HOME: '/home/me' }, prefix: 'az ' },
  { name: 'on Windows', env: { OS: 'Windows_NT', USERPROFILE: '/home/me' }, prefix: 'cmd /d /s /c az ' },
]) {
  test(`az: ${name} the ALM identity's own config folder is selected for the call, when that folder exists`, async ($, on) => {
    const azCalls: string[] = []
    const azEnvs: (Record<string, string> | undefined)[] = []
    world(on, {
      azCalls,
      azEnvs,
      azDirs: ['.azure-id-a'],
      env: { CLAUDE_CONFIG_DIR: '/cfg', ...env },
      branch: 'feature/orders-filter',
      remote: AZ_REMOTE,
      workspaces: AZ_WORKSPACES,
      azPr: AZ_PR,
    })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    expect(azCalls).toHaveLength(1)
    expect(azCalls[0]?.startsWith(prefix)).toBe(true)
    expect(azEnvs).toEqual([{ AZURE_CONFIG_DIR: `${env.USERPROFILE ?? env.HOME}/.azure-id-a` }])
  })
}

test('az: an identity whose config folder does not exist leaves the call with no AZURE_CONFIG_DIR, as hooks/lib/az-pin.js does', async ($, on) => {
  const azEnvs: (Record<string, string> | undefined)[] = []
  world(on, { azEnvs, azDirs: [], env: { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/me' }, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(azEnvs).toEqual([undefined])
})

test('PR: a branch that changes between a refresh\'s git read and its patch is asked again, not served from the read of the branch it left', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(ghCalls).toHaveLength(1)

  // A refresh reads the branch, then waits; meanwhile another one finds HEAD detached and patches that in.
  let release = () => {}
  options.holdRevParse = new Promise<void>(resolve => {
    release = resolve
  })
  await clock.advance(30_000)
  await settleAll()
  options.detached = true
  await clock.advance(30_000)
  await settleAll()
  options.detached = false
  release() // the first refresh patches the branch it read, over the one the snapshot now holds
  await settleAll()
  expect(ghCalls).toHaveLength(2)
  expect(await lavoroRows($)).toContain('#42 · open · Fix the orders filter')
})

test('Work: a PR created in the session (gh pr create) is a Link with its state, and is kept in the state file', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  on('tool.call', { tool: 'Bash' }, () => bashResult(`Creating pull request\n${GH_CREATED}\n`))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add filter" --body "x"' })
  await $.tool.call({ tool: 'Bash', command: 'git status' }) // not a create: nothing
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('PR · 1')
  expect(rows.some(r => /^#42 · open · Add filter$/.test(r))).toBe(true)
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe(GH_CREATED)
  await ui.unmount()
  await clock.advance(3000)
  expect(dataOf(writes)?.prs).toEqual([{ number: 42, title: 'Add filter', state: 'open', isDraft: false, url: GH_CREATED }])
})

test('Work: a PR created with az repos pr create takes its link from the repository web url', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'Bash' }, () =>
    bashResult(JSON.stringify({ pullRequestId: 9, title: 'Faster orders', status: 'active', isDraft: true, repository: { webUrl: 'https://dev.azure.com/o/p/_git/r' } })),
  )
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'az repos pr create --title "Faster orders" --draft true' })
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  expect(rowTexts(await ui.drawn()).some(r => /^#9 · draft · Faster orders$/.test(r))).toBe(true)
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://dev.azure.com/o/p/_git/r/pullrequest/9')
  await ui.unmount()
})

test('Work: a create that failed, was refused or printed no url adds no PR', async ($, on) => {
  world(on)
  let answer: { deny: string } | { result: object; isError?: true } = { deny: 'no' }
  on('tool.call', { tool: 'Bash' }, () => answer)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x' })
  answer = bashResult('error: could not create')
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x' })
  answer = { ...bashResult(GH_CREATED), isError: true }
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x' })
  expect((await lavoroRows($)).some(r => /^PR ·/.test(r))).toBe(false)
})

test('Work: the PRs of a session come back with it (the state file), whatever their state', async ($, on) => {
  const prs = [
    { number: 7, title: 'Old work', state: 'merged', isDraft: false, url: 'https://github.com/example/orders/pull/7' },
    { number: 8, title: 'Checks', state: 'open', isDraft: false, checks: { passed: 1, failed: 1, pending: 0 }, review: 'changes' },
  ]
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'work', prs }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('PR · 2')
  expect(rows.some(r => /^#7 · merged · Old work$/.test(r))).toBe(true)
  expect(rows.some(r => /^#8 · open · Checks$/.test(r))).toBe(true)
  expect(rows.some(r => /^ +review changes requested · checks 1\/2 · ✗ 1$/.test(r))).toBe(true)
  // a PR without a url is plain text, never a link to nowhere
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://github.com/example/orders/pull/7'])
  await ui.unmount()
})

test('Work: the read of the branch updates a PR already listed (created, then merged) instead of adding another', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH }
  const clock = world(on, options)
  on('tool.call', { tool: 'Bash' }, () => bashResult(GH_CREATED))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add filter"' })
  options.pr = 42
  options.prState = 'MERGED'
  options.prExtra = { url: GH_CREATED }
  await clock.advance(5 * MIN + 30_000)
  await settleAll()
  const rows = await lavoroRows($)
  expect(rows).toContain('PR · 1')
  expect(rows.filter(r => /^#42 /.test(r))).toEqual(['#42 · merged · Fix the orders filter'])
})

test('Work: an Azure PR seen active, then completed or abandoned, is read again and its entry follows the state', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES }
  const pr = (status: string) => [{ pullRequestId: 7, title: 'Faster orders', status, isDraft: false }]
  options.azPr = pr('active')
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await lavoroRows($)).toContain('#7 · open · Faster orders')
  options.azPr = pr('completed')
  await clock.advance(5 * MIN + 30_000)
  await settleAll()
  let rows = await lavoroRows($)
  expect(rows).toContain('PR · 1')
  expect(rows.filter(r => /^#7 /.test(r))).toEqual(['#7 · merged · Faster orders'])
  options.azPr = pr('abandoned')
  await clock.advance(5 * MIN + 30_000)
  await settleAll()
  rows = await lavoroRows($)
  expect(rows.filter(r => /^#7 /.test(r))).toEqual(['#7 · closed · Faster orders'])
})

test('follow-up: each PR row draws its review and checks line once', async ($, on) => {
  const prs = [{ number: 8, title: 'Checks', state: 'open', isDraft: false, checks: { passed: 1, failed: 1, pending: 0 }, review: 'changes' }]
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'work', prs }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  const rows = rowTexts(await ui.drawn())
  expect(rows.filter(r => /review changes requested/.test(r))).toHaveLength(1)
  await ui.unmount()
})

test('follow-up: a PR link that is not an http(s) address (a saved state, a CLI answer) is drawn as plain text', async ($, on) => {
  const prs = [
    { number: 7, title: 'Bad', state: 'open', isDraft: false, url: 'javascript:alert(1)' },
    { number: 8, title: 'Good', state: 'open', isDraft: false, url: 'https://github.com/example/orders/pull/8' },
  ]
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'work', prs }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://github.com/example/orders/pull/8'])
  await ui.unmount()
})

test('scoping: the pull requests of a session are not the next one\'s', async ($, on) => {
  let id = 's-1'
  const prs = [{ number: 8, title: 'Checks', state: 'open', isDraft: false, checks: { passed: 1, failed: 1, pending: 0 } }]
  world(on, { sessionId: () => id, dataFile: JSON.stringify({ history: [], prs }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await workRows($)).some(r => /#8/.test(r))).toBe(true)
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await workRows($)).some(r => /#8/.test(r))).toBe(false)
})

test('PR: a draft says bozza, changes requested and a review still due are told apart, no checks draws no checks row', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prExtra: { isDraft: true, reviewDecision: 'CHANGES_REQUESTED' } }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  let rows = await lavoroRows($)
  expect(rows).toContain('#42 · draft · Fix the orders filter')
  expect(rows).toContain('  review changes requested')
  expect(rows.some(r => /checks/.test(r))).toBe(false)

  options.prExtra = { reviewDecision: 'REVIEW_REQUIRED' }
  await clock.advance(5 * MIN)
  await settleAll()
  rows = await lavoroRows($)
  expect(rows).toContain('#42 · open · Fix the orders filter')
  expect(rows).toContain('  review pending')

  options.prExtra = { reviewDecision: '' }
  await clock.advance(5 * MIN)
  await settleAll()
  expect((await lavoroRows($)).some(r => /^ +review/.test(r))).toBe(false)
})
