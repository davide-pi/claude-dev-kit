import { expect, test } from 'claude-code/testing'

import { SYSTEM_KEEP, parseSysLine, recordSystem, sortProcs, systemOff } from '../hooks/system'

test('sortProcs: by the column asked, biggest first, the other column breaking a tie and a value not read yet last', () => {
  const procs = [
    { pid: 1, name: 'a', ports: [], cpu: 5, ram: 100 },
    { pid: 2, name: 'b', ports: [], cpu: 1, ram: 900 },
    { pid: 3, name: 'c', ports: [], ram: 500 },
    { pid: 4, name: 'd', ports: [], cpu: 5, ram: 50 },
  ]
  expect(sortProcs(procs, 'ram').map(p => p.pid)).toEqual([2, 3, 1, 4])
  expect(sortProcs(procs, 'cpu').map(p => p.pid)).toEqual([1, 4, 2, 3])
  expect(procs.map(p => p.pid)).toEqual([1, 2, 3, 4]) // the list given is not touched
  expect(sortProcs([], 'cpu')).toEqual([])
})

test('parseSysLine: one JSON line of the monitor, narrowed field by field; a bad line or a bad field is dropped, never thrown', () => {
  expect(parseSysLine('{"cpu":37,"ram":{"used":8,"total":16},"net":{"rx":1200,"tx":40}}')).toEqual({ cpu: 37, ram: { used: 8, total: 16 }, net: { rx: 1200, tx: 40 } })
  expect(parseSysLine('{"cpu":"x","ram":{"used":8},"net":null}')).toEqual({})
  expect(parseSysLine('nope')).toBeUndefined()
  expect(parseSysLine('[1]')).toBeUndefined()
  expect(parseSysLine('')).toBeUndefined()
  expect(parseSysLine('{"procs":[{"pid":1,"name":"node","ports":[3000,"x"]},{"pid":"z","name":"q"},{"pid":2,"name":"dotnet"}]}')).toEqual({
    procs: [
      { pid: 1, name: 'node', ports: [3000] },
      { pid: 2, name: 'dotnet', ports: [] },
    ],
  })
  expect(parseSysLine('{"disk":{"free":10,"total":100,"label":"D:"}}')).toEqual({ disk: { free: 10, total: 100, label: 'D:' } })
  expect(parseSysLine('{"disk":{"free":1}}')).toEqual({})
  expect(parseSysLine('{"off":["net","bogus","procs"]}')).toEqual({ off: ['net', 'procs'] })
})

test('recordSystem: samples go into rings of the last thirty, a part reported off is cleared and marked, a later reading brings it back', () => {
  const first = recordSystem(undefined, { cpu: 10, ram: { used: 4, total: 8 }, net: { rx: 100, tx: 50 } })
  expect(first).toEqual({ cpu: [10], ram: [50], rx: [100], tx: [50], off: [] })
  let s = first
  for (let i = 0; i < 40; i++) s = recordSystem(s, { cpu: i })
  expect(s.cpu).toHaveLength(SYSTEM_KEEP)
  expect(s.cpu.at(-1)).toBe(39)
  expect(s.ram).toEqual([50]) // a line without ram leaves it
  const off = recordSystem(s, { off: ['net'] })
  expect(off.off).toEqual(['net'])
  expect(off.rx).toEqual([])
  expect(off.tx).toEqual([])
  expect(recordSystem(off, { net: { rx: 1, tx: 2 } }).off).toEqual([])
  const slow = recordSystem(first, { procs: [{ pid: 1, name: 'node', ports: [3000] }], disk: { free: 5, total: 10 } })
  expect(slow.procs).toEqual([{ pid: 1, name: 'node', ports: [3000] }])
  expect(recordSystem(slow, { cpu: 1 }).procs).toEqual(slow.procs)
  expect(recordSystem(slow, { off: ['procs'] }).procs).toBeUndefined()
})

test('systemOff: every part marked unavailable, no samples', () => {
  expect(systemOff()).toEqual({ cpu: [], ram: [], rx: [], tx: [], off: ['cpu', 'ram', 'net', 'procs', 'disk'] })
})

test('parseSysLine: a process carries its CPU share and working set when they are counts', () => {
  expect(parseSysLine('{"procs":[{"pid":1,"name":"node","ports":[],"cpu":12.5,"ram":1048576},{"pid":2,"name":"x","cpu":"hi","ram":-1}]}')).toEqual({
    procs: [
      { pid: 1, name: 'node', ports: [], cpu: 12.5, ram: 1048576 },
      { pid: 2, name: 'x', ports: [] },
    ],
  })
})
