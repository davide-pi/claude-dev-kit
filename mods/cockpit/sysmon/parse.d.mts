export type NetBytes = { rx: number; tx: number }
export type Listening = { pid: number; port: number }
export type SysProc = { pid: number; ppid: number; name: string }
export type Battery = { kind: 'wired' } | { kind: 'battery'; percent: number; isCharging: boolean }
export type CpuTimes = { idle: number; total: number }

export function netBytes(text: string): NetBytes | undefined
export function netRate(before: NetBytes, after: NetBytes, seconds: number): NetBytes
export function listeningPorts(text: string): Listening[]
export function parseProcesses(text: string, rootPid: number, selfPid?: number): SysProc[] | undefined
export function withPorts(procs: readonly SysProc[], listening: readonly Listening[]): { pid: number; name: string; ports: number[] }[]
export function parseBattery(text: string): Battery | undefined
export function findSessionPid(texts: readonly string[], sessionId: string): number | undefined
export function cpuTimes(cpus: readonly { times: Readonly<Record<string, number>> }[]): CpuTimes
export function cpuPercent(before: CpuTimes, after: CpuTimes): number
