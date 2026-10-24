export type NetBytes = { rx: number; tx: number }
export type Listening = { pid: number; port: number }
/** A process of the session's tree: its CPU time in 100-ns units and working set in bytes when read, and its CPU share (percent) once two reads give one. */
export type SysProc = { pid: number; ppid: number; name: string; cpuTime?: number; ram?: number; cpu?: number }
export type ProcRow = { pid: number; name: string; ports: number[]; cpu?: number; ram?: number }
export type Battery = { kind: 'wired' } | { kind: 'battery'; percent: number; isCharging: boolean }
export type CpuTimes = { idle: number; total: number }

export function netBytes(text: string): NetBytes | undefined
export function netRate(before: NetBytes, after: NetBytes, seconds: number): NetBytes
export function listeningPorts(text: string): Listening[]
export function parseProcesses(text: string, rootPid: number, selfPid?: number): SysProc[] | undefined
export function withPorts(procs: readonly SysProc[], listening: readonly Listening[]): ProcRow[]
export function cpuTimesOf(procs: readonly { pid: number; cpuTime?: number }[]): Map<number, number>
export function cpuShares<T extends { pid: number; cpuTime?: number }>(procs: readonly T[], before: ReadonlyMap<number, number>, elapsedMs: number, cores: number): (T & { cpu?: number })[]
export function shapeProcesses(procs: readonly ProcRow[], keep: number): ProcRow[]
export function parseBattery(text: string): Battery | undefined
export function findSessionPid(texts: readonly string[], sessionId: string): number | undefined
export function cpuTimes(cpus: readonly { times: Readonly<Record<string, number>> }[]): CpuTimes
export function cpuPercent(before: CpuTimes, after: CpuTimes): number
