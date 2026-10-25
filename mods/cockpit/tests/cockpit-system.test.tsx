import { expect, test } from 'claude-code/testing'

import { ICONS, textCells } from '../hooks/shared'
import { FULL_LINE, GIB, RED, colorOf, fakeMonitor, mountPane, openCockpit, settleAll, sistemaRows, sleep, sysLine, until } from './cockpit-fixtures'
import { rowTexts, world } from './cockpit-world'

test('System: the monitor starts when the System tab is selected, with the session and config folder, and stops when another tab is', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  expect(m.spawns).toHaveLength(0) // another tab is selected: nothing runs
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  expect(m.spawns).toHaveLength(1)
  expect(m.spawns[0]?.argv[0]).toBe('node')
  expect(m.spawns[0]?.argv[1]).toMatch(/sysmon[\\/]sysmon\.mjs$/)
  expect(m.spawns[0]?.env).toEqual({ COCKPIT_SESSION_ID: 's-1', COCKPIT_CONFIG_DIR: '/cfg' })
  expect(m.stops).toBe(0)
  await ui.press({ key: 'tab:context' })
  await until(() => m.stops === 1)
  expect(m.stops).toBe(1)
  await ui.press({ key: 'tab:system' }) // back on the tab: a fresh monitor
  await until(() => m.spawns.length === 2)
  expect(m.spawns).toHaveLength(2)
  await ui.press({ key: 'tab:work' })
  await until(() => m.stops === 2)
  expect(m.stops).toBe(2)
  await ui.unmount()
})

test('System: pressing the System tab twice runs one monitor', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length > 0)
  await settleAll()
  expect(m.spawns).toHaveLength(1)
  expect(m.stops).toBe(0)
  await ui.unmount()
})

test('System: a pane that opens on the System tab (the saved one) starts the monitor', async ($, on) => {
  const m = fakeMonitor(on)
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'system' }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(m.spawns).toHaveLength(0) // the pane starts closed
  await openCockpit($)
  await until(() => m.spawns.length === 1)
  expect(m.spawns).toHaveLength(1)
})

test('System: the end of the session stops the monitor', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  await until(() => m.stops === 1)
  expect(m.stops).toBe(1)
  await ui.unmount()
})

type WrapBox = { props?: { flexWrap?: string }; children?: unknown[] }

/** The text of every wrapping Box of the drawn tree: each is a row of items the pane wraps by item. */
const wrapRows = (el: unknown): string[] => {
  const o = el as WrapBox | string | null
  if (o === null || typeof o === 'string') return []
  if (o.props?.flexWrap === 'wrap') return rowTexts({ children: [o] }).filter(r => r !== '')
  return (o.children ?? []).flatMap(wrapRows)
}

test('System: CPU, RAM and network on one row, the disk on the next, no sparkline, and the process table with its ports', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 58)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length > 0)
  for (const l of [FULL_LINE, sysLine({ cpu: 80, ram: { used: 14 * GIB, total: 32 * GIB }, net: { rx: 0, tx: 0 } })]) m.push(l)
  await until(() => m.queue.length === 0)
  await settleAll()
  const drawn = await ui.drawn()
  await ui.unmount()
  // a Box each, so the disk never rises to the first row when the network is quiet
  expect(wrapRows(drawn)).toEqual(['CPU 80%  RAM 44%  NET ↓0 B/s ↑0 B/s', `${ICONS.disk} D: 120 GB free`])
  const rows = rowTexts(drawn)
  const i = rows.indexOf('SYSTEM')
  expect(i).toBeGreaterThan(0)
  expect(rows.some(r => /[▁-█]/.test(r))).toBe(false)
  expect(rows).toContain('PROCESSES · 2')
  expect(rows.some(r => /^ +7000 bash *$/.test(r))).toBe(true)
  expect(rows.some(r => /^ +7240 node +:3000 :5173$/.test(r))).toBe(true)
  expect(rows.some(r => /in arrivo/.test(r))).toBe(false)
})

test('System: the numbers are the last reading, and a line split across two chunks is read whole', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const lines = [5, 5, 100].map(cpu => sysLine({ cpu }))
  const half = lines[2]?.length ? Math.floor(lines[2].length / 2) : 0
  const rows = await sistemaRows($, m, [lines[0] ?? '', lines[1] ?? '', lines[2]?.slice(0, half) ?? '', lines[2]?.slice(half) ?? ''])
  expect(rows.find(r => /^CPU/.test(r))).toMatch(/^CPU 100%  /)
})

test('System: a disk with little room left in red', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  m.push(sysLine({ disk: { free: 5 * GIB, total: 100 * GIB, label: 'D:' } }))
  await until(() => m.queue.length === 0)
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows.some(r => r.endsWith(`${ICONS.disk} D: 5.0 GB free`))).toBe(true)
  expect(colorOf(await ui.drawn(), /D: 5\.0 GB free/)).toBe(RED)
  await ui.unmount()
})

test('System: before the first line the tab says it is reading', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await sistemaRows($, m, [])
  expect(rows).toContain('SYSTEM')
  expect(rows).toContain('reading…')
})

test('System: a monitor that cannot start: CPU, RAM, network, disk and the processes all read unavailable', async ($, on) => {
  const m = fakeMonitor(on, { isBroken: true })
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('CPU unavailable  RAM unavailable  NET unavailable')
  expect(rows).toContain(`${ICONS.disk} unavailable`)
  expect(rows).toContain('unavailable')
  expect(rows).toContain('PROCESSES')
  await ui.unmount()
})

test('System: a part the monitor reports off (network on another platform) reads unavailable while the others draw', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await sistemaRows($, m, [sysLine({ cpu: 20, ram: { used: GIB, total: 8 * GIB }, off: ['net', 'procs'] })])
  expect(rows.find(r => /^CPU/.test(r))).toBe('CPU 20%  RAM 13%  NET unavailable')
  expect(rows).toContain('PROCESSES')
  expect(rows).toContain('unavailable')
})

test('System: the monitor ending on its own (a crash) turns every row to unavailable', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  m.push(FULL_LINE)
  await until(() => m.queue.length === 0)
  await settleAll()
  expect(rowTexts(await ui.drawn()).find(r => /^CPU/.test(r))).toMatch(/^CPU 37%  /)
  m.end()
  await until(() => m.stops === 1)
  await settleAll()
  const after = rowTexts(await ui.drawn()).find(r => /^CPU/.test(r)) ?? ''
  expect(after).toBe('CPU unavailable  RAM unavailable  NET unavailable')
  await ui.unmount()
})

test('System: the process table lists every process, with no row count and no cap', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const procs = Array.from({ length: 9 }, (_, n) => ({ pid: 100 + n, name: `proc${n}`, ports: [] }))
  const rows = await sistemaRows($, m, [sysLine({ procs })])
  expect(rows).toContain('PROCESSES · 9')
  expect(rows.filter(r => /proc\d *$/.test(r))).toHaveLength(9)
  expect(rows.some(r => /^… \+\d/.test(r))).toBe(false)
  const none = await sistemaRows($, m, [sysLine({ procs: [] })])
  expect(none).toContain('no child process')
})

test('System: every row fits the pane at 30, 40, 58 and 80 columns, a long process name and many ports cut with an ellipsis', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const long = sysLine({
    cpu: 100,
    ram: { used: 31 * GIB, total: 32 * GIB },
    net: { rx: 900 * 1024 ** 2, tx: 900 * 1024 ** 2 },
    procs: [{ pid: 123456, name: 'a-very-long-process-name-indeed', ports: [3000, 3001, 3002, 3003, 3004, 3005] }],
    disk: { free: 900 * GIB, total: 1000 * GIB, label: 'D:' },
  })
  for (const columns of [30, 40, 58, 80]) {
    const rows = await sistemaRows($, m, [long, long, long], columns)
    const width = Math.min(columns, 60) - 2
    const i = rows.indexOf('SYSTEM')
    expect(i).toBeGreaterThan(0)
    for (const row of rows.slice(i)) {
      if (/^─+$/.test(row)) continue
      // the numbers are items that wrap: each fits, the row of them need not
      for (const part of /^CPU/.test(row) ? row.split('  ') : [row]) expect(textCells(part)).toBeLessThanOrEqual(width)
    }
    expect(rows.slice(i).some(r => /^CPU/.test(r))).toBe(true)
  }
})

// ── Phase 6: phase 5 follow-ups ──

test('follow-up: a monitor stopped before it reached its spawn leaves no child running', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } }) // stops the monitor the press was still starting
  await sleep(100)
  await settleAll()
  expect(m.stops).toBe(m.spawns.length) // none started, or every one started was stopped
  await ui.unmount()
})

test('follow-up: after a monitor crash the readings are forgotten when the tab is left; the next visit starts from none', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  m.push(FULL_LINE)
  await until(() => m.queue.length === 0)
  m.end()
  await until(() => m.stops === 1)
  await settleAll()
  expect(rowTexts(await ui.drawn()).some(r => r.startsWith('CPU unavailable'))).toBe(true)
  m.isEnded = false
  await ui.press({ key: 'tab:context' })
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 2)
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('reading…')
  expect(rows.some(r => r.startsWith('CPU unavailable'))).toBe(false)
  await ui.unmount()
})

test('System: the numbers are those of the last reading, whatever the readings before it', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await sistemaRows($, m, [20, 40, 60].map(cpu => sysLine({ cpu, ram: { used: (cpu / 20) * 4 * 1024 ** 2, total: 16 * 1024 ** 2 }, net: { rx: (cpu / 20) * 1024 ** 2, tx: 0 } })))
  expect(rows.find(r => /^CPU/.test(r))?.startsWith('CPU 60%  RAM 75%  NET ↓3.0 MB/s ↑0 B/s')).toBe(true)
})

test('System: every process is listed with pid, name, CPU, RAM and its ports as links to localhost, by RAM, with no row count cap', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const many = Array.from({ length: 9 }, (_, n) => ({ pid: 100 + n, name: `proc${n}`, ports: [], cpu: 1, ram: 1024 ** 2 }))
  const procs = [{ pid: 7240, name: 'node', ports: [3000, 5173], cpu: 12, ram: 180 * 1024 ** 2 }, { pid: 7000, name: 'bash', ports: [], cpu: 0.4, ram: 12 * 1024 ** 2 }, ...many]
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length > 0)
  m.push(sysLine({ procs }))
  await until(() => m.queue.length === 0)
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('PROCESSES · 11')
  // a header row names the columns; the table is sorted by RAM, the sorted column marked
  expect(rows.some(r => /^ +PID NAME +CPU +RAM▾ PORTS$/.test(r))).toBe(true)
  expect(rows.some(r => /^ +7240 node +12% +180 MB :3000 :5173$/.test(r))).toBe(true)
  expect(rows.some(r => /^ +7000 bash +0\.4% +12 MB$/.test(r))).toBe(true)
  expect(rows.filter(r => /proc\d +1\.0% +1\.0 MB$/.test(r))).toHaveLength(9)
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['http://localhost:3000', 'http://localhost:5173'])
  expect(rows.some(r => /^… \+\d/.test(r))).toBe(false)
  await ui.unmount()
})

// ── Phase 9: System ──

test('System: the process table is sorted by RAM; a press on the CPU header sorts by CPU, a press on RAM back, and the sorted column is marked', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const procs = [
    { pid: 11, name: 'small', ports: [], cpu: 90, ram: 10 * 1024 ** 2 },
    { pid: 22, name: 'big', ports: [], cpu: 1, ram: 900 * 1024 ** 2 },
    { pid: 33, name: 'mid', ports: [], cpu: 50, ram: 100 * 1024 ** 2 },
  ]
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length > 0)
  m.push(sysLine({ procs }))
  await until(() => m.queue.length === 0)
  await settleAll()
  const order = async () => rowTexts(await ui.drawn()).flatMap(r => /^ +\d+ (small|big|mid)/.exec(r)?.[1] ?? [])
  const header = async () => rowTexts(await ui.drawn()).find(r => /PID NAME/.test(r))
  expect(await order()).toEqual(['big', 'mid', 'small'])
  expect(await header()).toMatch(/CPU +RAM▾ PORTS$/)
  await ui.press({ key: 'proc:cpu' })
  await settleAll()
  expect(await order()).toEqual(['small', 'mid', 'big'])
  expect(await header()).toMatch(/CPU▾ +RAM PORTS$/)
  await ui.press({ key: 'proc:ram' })
  await settleAll()
  expect(await order()).toEqual(['big', 'mid', 'small'])
  await ui.unmount()
})

// ── Phase 9: owner preview notes ──

test('System: the numbers row has the RAM as a percent only (no byte sizes), and CPU, RAM and network fit 58 columns at their widest', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await sistemaRows($, m, [sysLine({ cpu: 100, ram: { used: 31 * GIB, total: 32 * GIB }, net: { rx: 999 * 1024 ** 2, tx: 999 * 1024 ** 2 } })], 58)
  const row = rows.find(r => /^CPU/.test(r)) ?? ''
  expect(row).toMatch(/^CPU 100%  RAM 97%  NET ↓999 MB\/s ↑999 MB\/s/)
  expect(row).not.toMatch(/RAM [\d.]+ [KMG]?B/)
  expect(textCells(row.slice(0, row.indexOf('NET') + 'NET ↓999 MB/s ↑999 MB/s'.length))).toBeLessThanOrEqual(58)
})
