// Pure parsers of the system monitor (plain Node, no dependencies, no I/O): what the Windows tools print and the files
// the monitor reads, narrowed once here. Unit-tested in tests/sysmon.test.ts with recorded outputs.

const isRecord = v => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = v => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** `netstat -e`: the received and sent byte counters (the first row with two numbers, whatever its language); none when absent. */
export function netBytes(text) {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*[^\d\s].*?\s+(\d+)\s+(\d+)\s*$/.exec(line)
    if (m) return { rx: Number(m[1]), tx: Number(m[2]) }
  }
  return undefined
}

/** Counters of an old interface are 32 bits and wrap: a reading below the last one counts forward from the wrap. */
const counted = (before, after) => (after >= before ? after - before : after + 2 ** 32 - before)

/** Bytes per second between two `netBytes` readings `seconds` apart. */
export function netRate(before, after, seconds) {
  if (!(seconds > 0)) return { rx: 0, tx: 0 }
  return { rx: Math.round(counted(before.rx, after.rx) / seconds), tx: Math.round(counted(before.tx, after.tx) / seconds) }
}

/** `netstat -ano`: the TCP rows with no peer (foreign port 0: listening, in any language), as `{ pid, port }` once each, in order. */
export function listeningPorts(text) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S+:(\d+)\s+\S+:0\s+.*?(\d+)\s*$/i.exec(line)
    if (!m) continue
    const entry = { pid: Number(m[2]), port: Number(m[1]) }
    if (!out.some(o => o.pid === entry.pid && o.port === entry.port)) out.push(entry)
  }
  return out
}

/**
 * `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress` -> the descendants of
 * `rootPid`, parents first, without the root and without the subtree of `selfPid` (the monitor and the tools it starts). An
 * empty list when `rootPid` has none; none (undefined) when the text is not the expected JSON.
 */
export function parseProcesses(text, rootPid, selfPid) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const rows = (Array.isArray(parsed) ? parsed : [parsed]).flatMap(r =>
    isRecord(r) && isCount(r.ProcessId) && isCount(r.ParentProcessId) && typeof r.Name === 'string'
      ? [{ pid: r.ProcessId, ppid: r.ParentProcessId, name: r.Name.replace(/\.exe$/i, '') }]
      : [],
  )
  const out = []
  const seen = new Set([rootPid])
  const walk = parent => {
    for (const row of rows) {
      if (row.ppid !== parent || row.pid === selfPid || seen.has(row.pid)) continue
      seen.add(row.pid)
      out.push(row)
      walk(row.pid)
    }
  }
  walk(rootPid)
  return out
}

/** The processes with the ports each one listens on (sorted); `listening` is `listeningPorts`' answer. */
export function withPorts(procs, listening) {
  return procs.map(p => ({ pid: p.pid, name: p.name, ports: listening.filter(l => l.pid === p.pid).map(l => l.port).sort((a, b) => a - b) }))
}

// Win32_Battery.BatteryStatus: on AC (2), fully charged (3), charging (6-9), partly charged (11).
const ON_AC = [2, 3, 6, 7, 8, 9, 11]

/**
 * `Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress`: no output
 * is a machine with no battery (wired); else the charge and whether the power is plugged in. None for text that is neither.
 */
export function parseBattery(text) {
  if (text.trim() === '') return { kind: 'wired' }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const battery = Array.isArray(parsed) ? parsed[0] : parsed
  if (!isRecord(battery) || !isCount(battery.EstimatedChargeRemaining) || !isCount(battery.BatteryStatus)) return undefined
  return { kind: 'battery', percent: Math.min(100, battery.EstimatedChargeRemaining), isCharging: ON_AC.includes(battery.BatteryStatus) }
}

/** The pid of the `~/.claude/sessions/<pid>.json` file (given as texts) whose `sessionId` is `sessionId`; none when no file names it. */
export function findSessionPid(texts, sessionId) {
  for (const text of texts) {
    try {
      const file = JSON.parse(text)
      if (isRecord(file) && file.sessionId === sessionId && Number.isInteger(file.pid) && file.pid > 0) return file.pid
    } catch {
      // another file's text: not a session file
    }
  }
  return undefined
}

/** The idle and total CPU times of `os.cpus()` summed over the cores. */
export function cpuTimes(cpus) {
  let idle = 0
  let total = 0
  for (const { times } of cpus) {
    idle += times.idle
    total += Object.values(times).reduce((n, t) => n + t, 0)
  }
  return { idle, total }
}

/** The share of the time between two `cpuTimes` readings that the cores were busy, 0-100. */
export function cpuPercent(before, after) {
  const total = after.total - before.total
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(100 * (1 - (after.idle - before.idle) / total))))
}
