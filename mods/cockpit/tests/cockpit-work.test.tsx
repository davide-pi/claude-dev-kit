import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PERIMETER, SPAWN, lavoroRows, mountPane, paneRows, settleAll, spawnWorkflowAgent, spawns, workRows } from './cockpit-fixtures'
import { PANE, dataOf, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

test('IN PROGRESS: the deliver perimeter with its entries and touched files, and the changed files outside it', async ($, on) => {
  const gitCalls: string[] = []
  world(on, {
    gitCalls,
    branch: 'feat/x',
    perimeter: PERIMETER,
    changed: ['src/a.ts', 'src/b/x.ts', 'src/other.ts'],
    untracked: ['src/new.ts', 'notes.md'],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  const i = rows.findIndex(r => r === 'IN PROGRESS')
  expect(i).toBeGreaterThan(0)
  expect(rows[i - 1]).toBe(' ')
  expect(rows[i - 2]).toMatch(/^─+$/)
  expect(rows[i + 1]).toBe(' ')
  expect(rows[i + 2]).toBe('deliver perimeter · 2 entries · 5 files touched')
  expect(rows[i + 3]).toBe('󰀦 3 files outside the perimeter')
  expect(rows.slice(i + 4, i + 7)).toEqual(['  src/other.ts', '  src/new.ts', '  notes.md'])
  // computed like `scope-guard.js --check HEAD`: tracked changes against HEAD plus the untracked, not ignored files
  expect(gitCalls).toContain('git -C /work/example-repo --no-optional-locks diff --name-only --no-renames -z HEAD --')
  expect(gitCalls).toContain('git -C /work/example-repo --no-optional-locks ls-files --others --exclude-standard -z')
})

test('IN PROGRESS: nothing outside the perimeter says so; one entry and one file are singular', async ($, on) => {
  world(on, { branch: 'feat/x', perimeter: 'branch: feat/x\nstatus: active\n- src/a.ts\n', changed: ['src/a.ts'] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  expect(rows).toContain('deliver perimeter · 1 entry · 1 file touched')
  expect(rows).toContain('󰄬 no file outside the perimeter')
  expect(rows.some(r => /outside the perimeter$/.test(r) && r.startsWith('󰀦'))).toBe(false)
})

test('IN PROGRESS: 5 outside files are named, `󰍟 +n` opens the rest and `󰍝 −n` folds them', async ($, on) => {
  const changed = Array.from({ length: 7 }, (_, n) => `lib/f${n}.ts`)
  world(on, { branch: 'feat/x', perimeter: PERIMETER, changed })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  let rows = rowTexts(await ui.drawn())
  const i = rows.findIndex(r => r.startsWith('󰀦'))
  expect(rows[i]).toBe('󰀦 7 files outside the perimeter')
  expect(rows.slice(i + 1, i + 6)).toEqual(changed.slice(0, 5).map(f => `  ${f}`))
  expect((await ui.find({ key: 'outside:more' }))?.text).toBe('󰍟 +2')
  await ui.press({ key: 'outside:more' })
  await settleAll()
  rows = rowTexts(await ui.drawn())
  expect(rows.slice(i + 1, i + 8)).toEqual(changed.map(f => `  ${f}`))
  expect((await ui.find({ key: 'outside:more' }))?.text).toBe('󰍝 −2')
  await ui.press({ key: 'outside:more' })
  await settleAll()
  expect(rowTexts(await ui.drawn()).some(r => r === '  lib/f6.ts')).toBe(false)
  await ui.unmount()
})

test("IN PROGRESS: no perimeter for this branch (another branch's, closed): no perimeter rows and no git diff", async ($, on) => {
  const gitCalls: string[] = []
  world(on, { gitCalls, branch: 'feat/x', perimeter: PERIMETER.replace('feat/x', 'feat/other'), changed: ['lib/z.ts'] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  expect(rows.some(r => /perimetro/.test(r))).toBe(false)
  expect(rows).not.toContain('IN PROGRESS')
  // the changed files of the tab are listed from git, but no diff against the perimeter is made
  expect(gitCalls.filter(c => c.includes(' diff '))).toEqual([])
})

test('IN PROGRESS: a failed git diff leaves the entry count alone: no file counts, no claim about the outside', async ($, on) => {
  world(on, { branch: 'feat/x', perimeter: PERIMETER, failDiff: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  expect(rows).toContain('deliver perimeter · 2 entries')
  expect(rows.some(r => /outside the perimeter/.test(r))).toBe(false)
})

test('Work: neither the workflow block nor subagent blocks; the Subagents tab holds the agents', async ($, on) => {
  world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'code-reviewer', description: 'Review the orders filter' })
  await spawnWorkflowAgent($, 'wf_1', 1)
  expect((await workRows($)).some(r => /WORKFLOW|^agents \d|code-reviewer|Review the orders filter/.test(r))).toBe(false)
  expect((await paneRows($, 50, 'agents')).rows.some(r => /code-reviewer/.test(r))).toBe(true)
})

// ── Work: the changed files ──

test('Work: the changed files with +/- (a binary file bin, an untracked one ?), 8 rows, then `󰍟 +n` opens the rest', async ($, on) => {
  const numstat: [string, string, string][] = [
    ['12', '3', 'src/a.ts'],
    ['0', '5', 'src/b.ts'],
    ['-', '-', 'img.png'],
    ['1', '1', 'lib/f0.ts'],
    ['1', '1', 'lib/f1.ts'],
    ['1', '1', 'lib/f2.ts'],
  ]
  world(on, { numstat, untracked: ['notes.md', 'new.ts', 'x.ts', 'y.ts'] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  const files = (await ui.findAll({ type: 'Button' })).filter(b => /^file:/.test(b.key ?? ''))
  expect(files.map(b => b.key)).toEqual(
    ['src/a.ts', 'src/b.ts', 'img.png', 'lib/f0.ts', 'lib/f1.ts', 'lib/f2.ts', 'notes.md', 'new.ts'].map(f => `file:${f}`),
  )
  expect(files[0]?.text).toMatch(/^ +\+12 +-3 src\/a\.ts$/)
  expect(files[1]?.text).toMatch(/^ +\+0 +-5 src\/b\.ts$/)
  expect(files[2]?.text).toMatch(/^ +bin +img\.png$/)
  expect(files[6]?.text).toMatch(/^ +\? +notes\.md$/)
  const rows = rowTexts(await ui.drawn())
  const i = rows.findIndex(r => r === 'CHANGES · 10')
  expect(i).toBeGreaterThan(0)
  expect(rows[i + 1]).toBe(' ')
  expect((await ui.find({ key: 'changes:more' }))?.text).toBe('󰍟 +2')
  await ui.press({ key: 'changes:more' })
  await settleAll()
  const all = (await ui.findAll({ type: 'Button' })).filter(b => /^file:/.test(b.key ?? '')).map(b => b.key)
  expect(all.slice(8)).toEqual(['file:x.ts', 'file:y.ts'])
  expect((await ui.find({ key: 'changes:more' }))?.text).toBe('󰍝 −2')
  await ui.unmount()
})

test('Work: no changed files says so', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await lavoroRows($)
  expect(rows).toContain('CHANGES · 0')
  expect(rows).toContain('no changes')
})

test('Work: git is not read for it while another tab is selected', async ($, on) => {
  const gitCalls: string[] = []
  world(on, { gitCalls, numstat: [['1', '1', 'a.ts']], branch: 'feature/x' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(gitCalls).toEqual([])
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  expect(gitCalls).toContain('git -C /work/example-repo --no-optional-locks ls-files --others --exclude-standard -z')
  await ui.unmount()
})

// ── Work: the diff pane ──

const DIFF = ['diff --git a/src/a.ts b/src/a.ts', 'index 1111111..2222222 100644', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,3 @@', ' keep', '-old', '+new', '+added', ''].join('\n')
const HUNKS = DIFF.split('\n').slice(2).join('\n')
const DIFF_PANE = { ...PANE, requestId: 'cockpit-diff', props: { ...PANE.props, title: 'diff', bodyColumns: 80 } } as const

/** Presses the file `key` of the Work tab and returns the diff pane drawn afterwards. */
async function pressFile($: Engine, file: string) {
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  await ui.press({ key: `file:${file}` })
  await settleAll()
  await ui.unmount()
  return $.ui.mount({ ...DIFF_PANE, surface: 'terminal' })
}

test('diff pane: pressing a changed file opens `diff · <file>` and draws git diff HEAD -- <file> as diff hunks with Code', async ($, on) => {
  const opened: string[] = []
  const openedTitles: (string | undefined)[] = []
  const gitCalls: string[] = []
  world(on, { opened, openedTitles, gitCalls, numstat: [['2', '1', 'src/a.ts']], fileDiffs: { 'src/a.ts': DIFF } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const diff = await pressFile($, 'src/a.ts')
  expect(opened).toEqual(['cockpit-diff'])
  expect(openedTitles).toEqual(['diff · src/a.ts'])
  const code = await diff.find({ type: 'Code' })
  expect(code?.props).toMatchObject({ format: 'diff', source: HUNKS })
  expect(await diff.find({ type: 'Text', text: 'diff · src/a.ts' })).toBeDefined()
  await diff.unmount()
})

test('diff pane: an untracked file is drawn as all additions', async ($, on) => {
  world(on, { untracked: ['notes.md'], files: { 'notes.md': 'one\r\ntwo\n' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const diff = await pressFile($, 'notes.md')
  expect((await diff.find({ type: 'Code' }))?.props).toMatchObject({
    format: 'diff',
    source: '--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1,2 @@\n+one\n+two\n',
  })
  await diff.unmount()
})

test('diff pane: a diff with no hunks (a binary file) says so instead of drawing nothing', async ($, on) => {
  world(on, { numstat: [['-', '-', 'img.png']], fileDiffs: { 'img.png': 'diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const diff = await pressFile($, 'img.png')
  expect(await diff.find({ type: 'Code' })).toBeUndefined()
  expect(await diff.find({ type: 'Text', text: /no hunk/ })).toBeDefined()
  await diff.unmount()
})

test('diff pane: closable from its own button, which closes the pane and forgets the diff', async ($, on) => {
  const closed: string[] = []
  world(on, { closed, numstat: [['2', '1', 'src/a.ts']], fileDiffs: { 'src/a.ts': DIFF } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const diff = await pressFile($, 'src/a.ts')
  expect((await diff.find({ key: 'diff:close' }))?.text).toBe('close')
  await diff.press({ key: 'diff:close' })
  await settleAll()
  expect(closed).toEqual(['plugin'])
  await diff.unmount()
  const again = await $.ui.mount({ ...DIFF_PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Code' })).toBeUndefined()
  await again.unmount()
})

// ── Review follow-ups: the diff pane of a file that cannot be drawn, a branch that moves under a refresh ──

for (const { name, options } of [
  { name: 'over 4 MiB', options: { fileSizes: { 'big.log': 4 * 1024 * 1024 + 1 }, files: { 'big.log': 'x' } } },
  { name: 'unreadable', options: { unreadable: ['big.log'] } },
] satisfies { name: string; options: World }[]) {
  test(`diff pane: an untracked file ${name} opens the pane saying file too big or unreadable`, async ($, on) => {
    const opened: string[] = []
    world(on, { opened, untracked: ['big.log'], ...options })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const diff = await pressFile($, 'big.log')
    expect(opened).toEqual(['cockpit-diff'])
    expect(await diff.find({ type: 'Code' })).toBeUndefined()
    expect(await diff.find({ type: 'Text', text: 'file too big or unreadable' })).toBeDefined()
    expect(await diff.find({ type: 'Text', text: 'diff · big.log' })).toBeDefined()
    expect(await diff.find({ key: 'diff:close' })).toBeDefined()
    await diff.unmount()
  })
}

test('Work: the changed files with +/-, read only while Work is selected; no branch block and no worktree one', async ($, on) => {
  world(on, { numstat: [['3', '1', 'src/a.ts']], untracked: ['notes.md'], worktrees: 'worktree /work/example-repo\nHEAD 1\nbranch refs/heads/feature/x\n' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect(rowTexts(await ui.drawn()).some(r => /^CHANGES/.test(r))).toBe(false)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('CHANGES · 2')
  expect(rows.some(r => /^ +\+3 +-1 src\/a\.ts$/.test(r))).toBe(true)
  expect(rows.some(r => /^ +\? +notes\.md$/.test(r))).toBe(true)
  expect(rows).not.toContain('BRANCH')
  expect(rows.some(r => /^WORKTREE/.test(r))).toBe(false)
  await ui.unmount()
})

// ── Phase 9: Work ──

test('Work: the changed files are those against where the branch left the default branch, and the uncommitted ones; no branch block, no commits', async ($, on) => {
  const repoCalls: string[] = []
  world(on, { repoCalls, defaultBranch: 'main', mergeBase: 'abc1234def', upstream: 'origin/feature/x [ahead 2, behind 1]', numstat: [['3', '1', 'src/a.ts']] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  expect(repoCalls).toContain('diff --numstat --no-renames -z abc1234def --')
  expect(rows).toContain('CHANGES · 1')
  expect(rows).not.toContain('BRANCH')
  expect(rows.some(r => /commit.* from|upstream/.test(r))).toBe(false)
})

test('Work: with no default branch to count from (no origin/HEAD, no main or master) the changed files are the uncommitted ones against HEAD and no commits are listed', async ($, on) => {
  const repoCalls: string[] = []
  world(on, { repoCalls, numstat: [['1', '1', 'a.ts']] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  expect(rows).toContain('CHANGES · 1')
  expect(rows.some(r => /commit.* from/.test(r))).toBe(false)
  expect(repoCalls).toContain('diff --numstat --no-renames -z HEAD --')
})

test('Work: a detached HEAD has no branch block', async ($, on) => {
  world(on, { detached: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await workRows($)).includes('BRANCH')).toBe(false)
})

test('Work: the diff of a changed file is taken against the commit the branch left the default branch at', async ($, on) => {
  const repoCalls: string[] = []
  world(on, { repoCalls, defaultBranch: 'main', mergeBase: 'abc1234def', numstat: [['2', '1', 'src/a.ts']], fileDiffs: { 'src/a.ts': DIFF } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const diff = await pressFile($, 'src/a.ts')
  expect(repoCalls).toContain('diff --no-color --no-ext-diff --no-renames abc1234def -- src/a.ts')
  await diff.unmount()
})

test('Work: the files this chat edited (a subagent too) carry a marker on the changes, made repo-relative; it is kept in the session data and survives a resume', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes, numstat: [['1', '1', 'src/a.ts'], ['2', '0', 'src/b.ts'], ['3', '3', 'other.ts']] })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/work/example-repo/src/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/work/example-repo/src/b.ts', content: '' , agentId: 'a1' })
  await $.tool.call({ tool: 'Edit', file_path: '/elsewhere/x.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Read', file_path: '/work/example-repo/other.ts' }) // a read is not an edit
  const rows = await workRows($)
  expect(rows.find(r => /src\/a\.ts/.test(r))).toMatch(/src\/a\.ts 󰧞$/)
  expect(rows.find(r => /src\/b\.ts/.test(r))).toMatch(/src\/b\.ts 󰧞$/)
  expect(rows.find(r => /other\.ts/.test(r))).toMatch(/other\.ts$/)
  expect(rows.some(r => /^CHANGES · 3󰧞 this chat$/.test(r))).toBe(true)
  await clock.advance(5000) // past the write throttle
  expect(dataOf(writes)?.edited).toEqual(['/work/example-repo/src/a.ts', '/work/example-repo/src/b.ts', '/elsewhere/x.ts'])
})

test('Work: a resumed session marks the files its data file lists', async ($, on) => {
  world(on, { dataFile: JSON.stringify({ history: [], edited: ['/work/example-repo/src/a.ts', 7, ''] }), numstat: [['1', '1', 'src/a.ts']] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await workRows($)).find(r => /src\/a\.ts/.test(r))).toMatch(/src\/a\.ts 󰧞$/)
})

test('Work: with no edited file there is no marker and no legend', async ($, on) => {
  world(on, { numstat: [['1', '1', 'src/a.ts']] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  expect(rows.find(r => /src\/a\.ts/.test(r))).toMatch(/src\/a\.ts$/)
  expect(rows.some(r => /this chat/.test(r))).toBe(false)
})
