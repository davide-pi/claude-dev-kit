// The cockpit's process reader: one read, one JSON line on stdout, then it exits. The mod runs it only while the Lavoro tab is open:
//
//   { procs: [{ pid, name, ports, ram? }] }   the session's descendant processes (console helpers hidden) with their listening ports and working set
//   { off: ['procs'] }                        the processes cannot be read here (not Windows, no session file, a tool missing or too slow)
//
// Environment: COCKPIT_SESSION_ID (the session whose ~/.claude/sessions/<pid>.json names the Claude pid) and COCKPIT_CONFIG_DIR (~/.claude when absent).
// Windows only: one CIM query (~0.5 s) and `netstat -ano` (~35 ms).

import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { findSessionPid, listeningPorts, parseProcesses, shapeProcesses, withPorts } from './parse.mjs'

const PROCS_KEEP = 200
const sessionId = process.env.COCKPIT_SESSION_ID ?? ''
const configDir = process.env.COCKPIT_CONFIG_DIR || join(homedir(), '.claude')

const emit = fields => process.stdout.write(`${JSON.stringify(fields)}\n`)

/** The stdout of a command, or undefined when it is missing, fails or is too slow. */
const run = (command, args, timeout) =>
  new Promise(resolve => {
    execFile(command, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => resolve(error ? undefined : stdout))
  })

async function main() {
  if (process.platform !== 'win32') return emit({ off: ['procs'] })
  try {
    const dir = join(configDir, 'sessions')
    const names = (await readdir(dir)).filter(n => n.endsWith('.json'))
    const texts = await Promise.all(names.map(n => readFile(join(dir, n), 'utf8').catch(() => '')))
    const root = findSessionPid(texts, sessionId)
    const table = root === undefined ? undefined : await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress'], 8000)
    const procs = table === undefined || root === undefined ? undefined : parseProcesses(table, root, process.pid)
    if (procs === undefined) return emit({ off: ['procs'] })
    const sockets = await run('netstat', ['-ano'], 5000)
    emit({ procs: shapeProcesses(withPorts(procs, sockets === undefined ? [] : listeningPorts(sockets)), PROCS_KEEP) })
  } catch {
    emit({ off: ['procs'] })
  }
}

await main()
