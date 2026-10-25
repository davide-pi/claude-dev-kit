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

/**
 * Counters of an old interface are 32 bits and wrap: a reading below the last one counts forward from the wrap only when the last
 * one was within a gigabyte of the limit (what two seconds can move); any other drop is a reset, counted as nothing.
 */
const counted = (before, after) => (after >= before ? after - before : before > 2 ** 32 - 2 ** 30 && before <= 2 ** 32 ? after + 2 ** 32 - before : 0)

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
 * `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,KernelModeTime,UserModeTime,WorkingSetSize |
 * ConvertTo-Json -Compress` -> the descendants of `rootPid`, parents first, without the root and without the subtree of `selfPid`
 * (the monitor and the tools it starts), each with its CPU time (kernel plus user, in 100-ns units) and working set when the query
 * gave them as counts. An empty list when `rootPid` has none; none (undefined) when the text is not the expected JSON.
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
      ? [
          {
            pid: r.ProcessId,
            ppid: r.ParentProcessId,
            name: r.Name.replace(/\.exe$/i, ''),
            ...(isCount(r.KernelModeTime) && isCount(r.UserModeTime) && { cpuTime: r.KernelModeTime + r.UserModeTime }),
            ...(isCount(r.WorkingSetSize) && { ram: r.WorkingSetSize }),
          },
        ]
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

/** The processes with the ports each one listens on (sorted), their CPU share and their working set; `listening` is `listeningPorts`' answer. */
export function withPorts(procs, listening) {
  return procs.map(p => ({
    pid: p.pid,
    name: p.name,
    ports: listening.filter(l => l.pid === p.pid).map(l => l.port).sort((a, b) => a - b),
    ...(p.cpu !== undefined && { cpu: p.cpu }),
    ...(p.ram !== undefined && { ram: p.ram }),
  }))
}

/** The CPU time of each process that has one, by pid: what the next read measures its share against. */
export function cpuTimesOf(procs) {
  return new Map(procs.flatMap(p => (p.cpuTime === undefined ? [] : [[p.pid, p.cpuTime]])))
}

/**
 * Each process with its CPU share: the CPU time spent since `before` (a `cpuTimesOf` map of the read `elapsedMs` ago, 100-ns units)
 * over the elapsed time of every core, to a tenth of a percent. A process the last read did not have, one whose counter went back
 * (a reused pid) or a read with no elapsed time has no share.
 */
export function cpuShares(procs, before, elapsedMs, cores) {
  return procs.map(p => {
    const last = before.get(p.pid)
    if (!(elapsedMs > 0) || !(cores > 0) || p.cpuTime === undefined || last === undefined || p.cpuTime < last) return p
    const cpuMs = (p.cpuTime - last) / 1e4
    return { ...p, cpu: Math.min(100, Math.round((1000 * cpuMs) / (elapsedMs * cores)) / 10) }
  })
}

/** Service helpers of a console (the window host, the shell wrapper): never what the person wants to see in the list. */
const isHelper = name => /^(conhost|cmd)$/i.test(name)

/** The processes the table lists: helpers hidden, the busiest first (CPU, then RAM; a process with no CPU share after those that have one), at most `keep`. */
export function shapeProcesses(procs, keep) {
  const byCpu = (a, b) => (b.cpu ?? -1) - (a.cpu ?? -1) || (b.ram ?? 0) - (a.ram ?? 0) || a.pid - b.pid
  return procs.filter(p => !isHelper(p.name)).sort(byCpu).slice(0, keep)
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
