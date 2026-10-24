import { expect, test } from 'claude-code/testing'

import { cpuPercent, cpuShares, cpuTimes, cpuTimesOf, findSessionPid, listeningPorts, netBytes, netRate, parseBattery, parseProcesses, shapeProcesses, withPorts } from '../sysmon/parse.mjs'

// Recorded outputs of the Windows tools the monitor reads (trimmed to the lines the parsers use).

const NETSTAT_E_EN = [
  'Interface Statistics',
  '',
  '                           Received            Sent',
  '',
  'Bytes                    3057328368      2440696684',
  'Unicast packets           201521052       132348152',
  'Non-unicast packets         1928652         2009136',
  'Discards                      33784               0',
  'Errors                            0               0',
  'Unknown protocols                 0',
  '',
].join('\r\n')

const NETSTAT_E_IT = [
  'Statistiche interfaccia',
  '',
  '                           Ricevuti           Inviati',
  '',
  'Byte                         51200           10240',
  'Pacchetti unicast               12              9',
  '',
].join('\r\n')

const NETSTAT_ANO = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1780',
  '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       7240',
  '  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       7240',
  '  TCP    127.0.0.1:49722        127.0.0.1:5173         ESTABLISHED     9100',
  '  TCP    [::]:5173              [::]:0                 LISTENING       7240',
  '  TCP    [::]:8080              [::]:0                 IN ASCOLTO      8800',
  '  UDP    0.0.0.0:5353           *:*                                    2200',
  '  UDP    [::]:5353              *:*                                    2200',
  '',
].join('\r\n')

const CIM_PROCESSES = JSON.stringify([
  { ProcessId: 4, ParentProcessId: 0, Name: 'System' },
  { ProcessId: 100, ParentProcessId: 4, Name: 'claude.exe' },
  { ProcessId: 7000, ParentProcessId: 100, Name: 'bash.exe' },
  { ProcessId: 7240, ParentProcessId: 7000, Name: 'node.exe' },
  { ProcessId: 8800, ParentProcessId: 100, Name: 'dotnet.exe' },
  { ProcessId: 9100, ParentProcessId: 5000, Name: 'chrome.exe' },
  { ProcessId: 9200, ParentProcessId: 100, Name: 'node.exe' },
  { ProcessId: 9300, ParentProcessId: 9200, Name: 'powershell.exe' },
])

test('netBytes: the received and sent counters of the first row of `netstat -e`, whatever the language', () => {
  expect(netBytes(NETSTAT_E_EN)).toEqual({ rx: 3057328368, tx: 2440696684 })
  expect(netBytes(NETSTAT_E_IT)).toEqual({ rx: 51200, tx: 10240 })
  expect(netBytes('')).toBeUndefined()
  expect(netBytes('The requested operation requires elevation.')).toBeUndefined()
})

test('netRate: bytes per second between two readings; a 32-bit counter that wrapped still counts forward', () => {
  expect(netRate({ rx: 1000, tx: 500 }, { rx: 5000, tx: 700 }, 2)).toEqual({ rx: 2000, tx: 100 })
  expect(netRate({ rx: 2 ** 32 - 1000, tx: 0 }, { rx: 1000, tx: 0 }, 2)).toEqual({ rx: 1000, tx: 0 })
  expect(netRate({ rx: 1, tx: 1 }, { rx: 1, tx: 1 }, 0)).toEqual({ rx: 0, tx: 0 })
  // a counter that drops far from the 32-bit limit was reset (an interface restarted): no rate for that sample, not a wrap
  expect(netRate({ rx: 5_000_000, tx: 100 }, { rx: 1000, tx: 0 }, 2)).toEqual({ rx: 0, tx: 0 })
  expect(netRate({ rx: 2 ** 31, tx: 2 ** 31 }, { rx: 10, tx: 10 }, 2)).toEqual({ rx: 0, tx: 0 })
  expect(netRate({ rx: 2 ** 32 - 100, tx: 5_000_000 }, { rx: 100, tx: 4_000_000 }, 2)).toEqual({ rx: 100, tx: 0 })
  // a 64-bit counter above the 32-bit limit cannot have wrapped there: its drop is a reset too, never a negative rate
  expect(netRate({ rx: 5e9, tx: 2 ** 32 + 10 }, { rx: 1000, tx: 5 }, 2)).toEqual({ rx: 0, tx: 0 })
})

test('listeningPorts: the TCP rows with no peer, by pid, in any language; established and UDP rows are not listening', () => {
  expect(listeningPorts(NETSTAT_ANO)).toEqual([
    { pid: 1780, port: 135 },
    { pid: 7240, port: 5173 },
    { pid: 7240, port: 3000 },
    { pid: 8800, port: 8080 },
  ])
  expect(listeningPorts('')).toEqual([])
})

test('parseProcesses: the descendants of the Claude pid, parents first, without the root and without the own subtree of the monitor (its pid and the tools it started); a lone object and bad text', () => {
  expect(parseProcesses(CIM_PROCESSES, 100, 9200)).toEqual([
    { pid: 7000, ppid: 100, name: 'bash' },
    { pid: 7240, ppid: 7000, name: 'node' },
    { pid: 8800, ppid: 100, name: 'dotnet' },
  ])
  expect(parseProcesses(CIM_PROCESSES, 9999)).toEqual([])
  expect(parseProcesses(JSON.stringify({ ProcessId: 5, ParentProcessId: 1, Name: 'x.exe' }), 1)).toEqual([{ pid: 5, ppid: 1, name: 'x' }])
  expect(parseProcesses('not json', 100)).toBeUndefined()
  expect(parseProcesses('', 100)).toBeUndefined()
})

test('parseProcesses: a parent cycle does not loop', () => {
  const cycle = JSON.stringify([
    { ProcessId: 1, ParentProcessId: 2, Name: 'a.exe' },
    { ProcessId: 2, ParentProcessId: 1, Name: 'b.exe' },
  ])
  expect((parseProcesses(cycle, 1) ?? []).map(p => p.pid)).toEqual([2])
})

test('withPorts: each process takes the ports it listens on, sorted', () => {
  const procs = parseProcesses(CIM_PROCESSES, 100, 9200) ?? []
  expect(withPorts(procs, listeningPorts(NETSTAT_ANO))).toEqual([
    { pid: 7000, name: 'bash', ports: [] },
    { pid: 7240, name: 'node', ports: [3000, 5173] },
    { pid: 8800, name: 'dotnet', ports: [8080] },
  ])
})

test('parseBattery: no battery is wired power; a battery reads its charge and whether it charges; garbage is none', () => {
  expect(parseBattery('')).toEqual({ kind: 'wired' })
  expect(parseBattery('\r\n')).toEqual({ kind: 'wired' })
  expect(parseBattery('{"EstimatedChargeRemaining":87,"BatteryStatus":2}')).toEqual({ kind: 'battery', percent: 87, isCharging: true })
  expect(parseBattery('{"EstimatedChargeRemaining":40,"BatteryStatus":1}')).toEqual({ kind: 'battery', percent: 40, isCharging: false })
  expect(parseBattery('[{"EstimatedChargeRemaining":55,"BatteryStatus":6}]')).toEqual({ kind: 'battery', percent: 55, isCharging: true })
  expect(parseBattery('{"BatteryStatus":2}')).toBeUndefined()
  expect(parseBattery('oops')).toBeUndefined()
})

test('findSessionPid: the pid of the session file whose sessionId matches; none otherwise', () => {
  const files = [
    '{"pid":25516,"sessionId":"aaa","cwd":"/w"}',
    'not json',
    '{"pid":"x","sessionId":"bbb"}',
    '{"pid":31337,"sessionId":"ccc","kind":"interactive"}',
  ]
  expect(findSessionPid(files, 'ccc')).toBe(31337)
  expect(findSessionPid(files, 'aaa')).toBe(25516)
  expect(findSessionPid(files, 'bbb')).toBeUndefined()
  expect(findSessionPid(files, 'zzz')).toBeUndefined()
})

test('cpuPercent: the busy share of the time between two readings of os.cpus(), 0-100', () => {
  const cpus = (idle: number, busy: number) => [{ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } }]
  expect(cpuTimes(cpus(100, 50))).toEqual({ idle: 100, total: 150 })
  expect(cpuPercent(cpuTimes(cpus(100, 50)), cpuTimes(cpus(160, 90)))).toBe(40)
  expect(cpuPercent(cpuTimes(cpus(100, 50)), cpuTimes(cpus(100, 50)))).toBe(0)
  expect(cpuPercent(cpuTimes(cpus(0, 0)), cpuTimes(cpus(0, 10)))).toBe(100)
})

// ── v3.1: CPU and RAM per process, the order of the table ──

const CIM_WITH_TIMES = JSON.stringify([
  { ProcessId: 100, ParentProcessId: 4, Name: 'claude.exe', KernelModeTime: 1, UserModeTime: 1, WorkingSetSize: 1 },
  { ProcessId: 7000, ParentProcessId: 100, Name: 'bash.exe', KernelModeTime: 4_000_000, UserModeTime: 6_000_000, WorkingSetSize: 12_582_912 },
  { ProcessId: 7240, ParentProcessId: 7000, Name: 'conhost.exe', KernelModeTime: 10, UserModeTime: 5, WorkingSetSize: 2048 },
  { ProcessId: 7300, ParentProcessId: 7000, Name: 'node.exe', KernelModeTime: 'x', UserModeTime: 5, WorkingSetSize: 4096 },
])

test('parseProcesses: the CPU time (kernel plus user, 100 ns units) and the working set ride with each process; one that is not a count is left out', () => {
  expect(parseProcesses(CIM_WITH_TIMES, 100)).toEqual([
    { pid: 7000, ppid: 100, name: 'bash', cpuTime: 10_000_000, ram: 12_582_912 },
    { pid: 7240, ppid: 7000, name: 'conhost', cpuTime: 15, ram: 2048 },
    { pid: 7300, ppid: 7000, name: 'node', ram: 4096 },
  ])
})

test('cpuShares: the CPU time spent between two reads over the elapsed time of every core, to a tenth; a new process or a restarted counter has no share', () => {
  const procs = [
    { pid: 1, name: 'a', ports: [], cpuTime: 1_000_000_000 + 2_000_000 },
    { pid: 2, name: 'b', ports: [], cpuTime: 40_000_000 },
    { pid: 3, name: 'c', ports: [], cpuTime: 500 },
    { pid: 4, name: 'd', ports: [], cpuTime: 5 },
    { pid: 5, name: 'e', ports: [] },
  ]
  const before = new Map([
    [1, 1_000_000_000],
    [2, 0],
    [3, 9_999],
  ])
  // 200 ms of 10 s on 4 cores is 0.5 %, 4 s of it is 10 %
  expect(cpuShares(procs, before, 10_000, 4).map(p => p.cpu)).toEqual([0.5, 10, undefined, undefined, undefined])
  expect(cpuShares(procs, before, 0, 4).map(p => p.cpu)).toEqual([undefined, undefined, undefined, undefined, undefined])
  expect(cpuTimesOf(procs)).toEqual(
    new Map([
      [1, 1_002_000_000],
      [2, 40_000_000],
      [3, 500],
      [4, 5],
    ]),
  )
})

test('shapeProcesses: the service helpers (conhost, cmd) are hidden, the rest go by CPU then RAM, a process with no CPU share after those that have one', () => {
  const p = (pid: number, name: string, cpu?: number, ram?: number) => ({ pid, name, ports: [], ...(cpu !== undefined && { cpu }), ...(ram !== undefined && { ram }) })
  const shaped = shapeProcesses([p(1, 'conhost', 90, 1), p(2, 'node', 5, 100), p(3, 'CMD', 80), p(4, 'bash', 5, 300), p(5, 'x', undefined, 999), p(6, 'dotnet', 20, 1), p(7, 'y', undefined, 5)], 200)
  expect(shaped.map(x => x.pid)).toEqual([6, 4, 2, 5, 7])
  expect(shapeProcesses([p(1, 'a', 1), p(2, 'b', 2), p(3, 'c', 3)], 2).map(x => x.pid)).toEqual([3, 2])
})

test('withPorts: the CPU share and the working set go on with the ports', () => {
  const procs = [{ pid: 7000, ppid: 100, name: 'bash', cpu: 3.5, ram: 1024 }]
  expect(withPorts(procs, [{ pid: 7000, port: 80 }])).toEqual([{ pid: 7000, name: 'bash', ports: [80], cpu: 3.5, ram: 1024 }])
})
