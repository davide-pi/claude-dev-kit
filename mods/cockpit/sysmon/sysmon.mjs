// The cockpit's system monitor: a plain Node child (no dependencies) that the mod starts only while the Sistema tab is
// selected and the pane is open, and closes when either stops being true. It prints one JSON line per event on stdout:
//
//   every 2 s   { cpu: 0-100, ram: { used, total }, net?: { rx, tx } }     (CPU, RAM, network bytes per second)
//   every 10 s  { procs: [{ pid, name, ports }] }   the session's descendant processes with their listening ports
//   every 30 s  { disk: { free, total, label } }    the drive of the working directory
//   once        { power: { kind: 'wired' } | { kind: 'battery', percent, isCharging } }
//   a part that cannot be read: { off: ['net', ...] } (the mod draws "non disponibile"; the monitor never throws for it)
//
// Environment: COCKPIT_SESSION_ID (the session whose ~/.claude/sessions/<pid>.json names the Claude pid) and
// COCKPIT_CONFIG_DIR (the config folder, ~/.claude when absent). Network, processes and power are read on Windows only.
//
// Cost of the Windows reads, measured on the owner's machine (median of three, one process each, from node):
//   netstat -e 30 ms, netstat -ano 35 ms                         -> every tick / every 10 s
//   powershell -NoProfile Get-CimInstance Win32_Process 550 ms   -> every 10 s only (ProcessId, ParentProcessId, Name: 37 KB;
//                                                                   with CommandLine 214 KB for the same time, so it is left out)
//   Get-WmiObject 780 ms, tasklist 650 ms (and no parent pid), wmic: not installed
//   Win32_Battery 265 ms                                         -> once
// A PowerShell per tick would cost a quarter of every 2 s; one CIM query per 10 s, started without waiting for the tick, costs ~5 %.

import { execFile } from 'node:child_process'
import { readFile, readdir, statfs } from 'node:fs/promises'
import { cpus, freemem, homedir, totalmem } from 'node:os'
import { join, parse } from 'node:path'

import { cpuPercent, cpuTimes, findSessionPid, listeningPorts, netBytes, netRate, parseBattery, parseProcesses, withPorts } from './parse.mjs'

const TICK_MS = 2000
/** Ticks between two reads of the processes (10 s) and of the disk (30 s). */
const PROCS_EVERY = 5
const DISK_EVERY = 15

const isWindows = process.platform === 'win32'
const sessionId = process.env.COCKPIT_SESSION_ID ?? ''
const configDir = process.env.COCKPIT_CONFIG_DIR || join(homedir(), '.claude')

const emit = fields => {
  process.stdout.write(`${JSON.stringify(fields)}\n`)
}

/** The stdout of a command, or undefined when it is missing, fails or is too slow. */
const run = (command, args, timeout) =>
  new Promise(resolve => {
    execFile(command, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => resolve(error ? undefined : stdout))
  })

const powershell = script => run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 8000)

let lastCpu = cpuTimes(cpus())
let lastNet
let lastNetAt = 0
let claudePid
let isReadingProcs = false

/** The Claude pid of this session: the `sessions/<pid>.json` file that names it; kept once found. */
async function findClaudePid() {
  if (claudePid !== undefined) return claudePid
  const dir = join(configDir, 'sessions')
  const names = (await readdir(dir)).filter(n => n.endsWith('.json'))
  const texts = await Promise.all(names.map(n => readFile(join(dir, n), 'utf8').catch(() => '')))
  claudePid = findSessionPid(texts, sessionId)
  return claudePid
}

async function readProcs() {
  if (isReadingProcs) return
  isReadingProcs = true
  try {
    const root = await findClaudePid()
    const table = root === undefined ? undefined : await powershell('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress')
    const procs = table === undefined || root === undefined ? undefined : parseProcesses(table, root, process.pid)
    if (procs === undefined) return emit({ off: ['procs'] })
    const sockets = await run('netstat', ['-ano'], 5000)
    emit({ procs: withPorts(procs.slice(0, 50), sockets === undefined ? [] : listeningPorts(sockets)) })
  } catch {
    emit({ off: ['procs'] })
  } finally {
    isReadingProcs = false
  }
}

async function readDisk() {
  try {
    const cwd = process.cwd()
    const s = await statfs(cwd)
    emit({ disk: { free: s.bavail * s.bsize, total: s.blocks * s.bsize, label: parse(cwd).root.replace(/[\\/]+$/, '') || '/' } })
  } catch {
    emit({ off: ['disk'] })
  }
}

async function readPower() {
  const out = await powershell('Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress')
  const power = out === undefined ? undefined : parseBattery(out)
  emit(power === undefined ? { off: ['power'] } : { power })
}

async function readNet() {
  const out = await run('netstat', ['-e'], 3000)
  const now = Date.now()
  const bytes = out === undefined ? undefined : netBytes(out)
  if (bytes === undefined) return { off: ['net'] }
  const rate = lastNet === undefined ? undefined : netRate(lastNet, bytes, (now - lastNetAt) / 1000)
  lastNet = bytes
  lastNetAt = now
  return rate === undefined ? {} : { net: rate }
}

let tickCount = 0

async function tick() {
  const n = tickCount++
  const times = cpuTimes(cpus())
  const line = { ram: { used: totalmem() - freemem(), total: totalmem() }, ...(n > 0 && { cpu: cpuPercent(lastCpu, times) }) }
  lastCpu = times
  if (isWindows) {
    const net = await readNet()
    if ('off' in net) line.off = net.off
    else Object.assign(line, net)
  }
  emit(line)
  if (isWindows && n % PROCS_EVERY === 0) void readProcs()
  if (n % DISK_EVERY === 0) void readDisk()
}

// The stdout pipe closing ends the monitor (the engine also kills it when the mod stops reading).
process.stdout.on('error', () => process.exit(0))

if (isWindows) void readPower()
else emit({ off: ['net', 'procs', 'power'] })
void tick()
setInterval(() => void tick(), TICK_MS)
