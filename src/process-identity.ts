import { readFileSync } from "node:fs"

const BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id"
const TERMINAL_PROCESS_STATES = new Set(["Z", "X", "x"])

export interface ProcessIdentity {
  platform: "linux"
  bootId: string
  pid: number
  processGroupId: number
  startTimeTicks: string
}

export interface ProcessObservation extends ProcessIdentity {
  state: string
}

export type ProcessIdentityReader = (pid: number) => ProcessObservation | null

export function captureProcessIdentity(
  pid: number,
  readIdentity: ProcessIdentityReader = readLinuxProcessIdentity
): ProcessIdentity | null {
  const observation = readIdentity(pid)
  if (!observation || isTerminalProcessState(observation.state)) return null

  const { state: _, ...identity } = observation
  return identity
}

export function isSameLiveProcess(
  recorded: ProcessIdentity,
  readIdentity: ProcessIdentityReader = readLinuxProcessIdentity
): boolean {
  const current = readIdentity(recorded.pid)
  return current !== null
    && !isTerminalProcessState(current.state)
    && current.platform === recorded.platform
    && current.bootId === recorded.bootId
    && current.pid === recorded.pid
    && current.processGroupId === recorded.processGroupId
    && current.startTimeTicks === recorded.startTimeTicks
}

export function readLinuxProcessIdentity(pid: number): ProcessObservation | null {
  if (process.platform !== "linux" || !Number.isSafeInteger(pid) || pid <= 0) return null

  try {
    const bootId = readFileSync(BOOT_ID_PATH, "utf8").trim()
    const stat = parseLinuxProcStat(readFileSync(`/proc/${pid}/stat`, "utf8"))
    if (!bootId || !stat || stat.pid !== pid) return null

    return {
      platform: "linux",
      bootId,
      pid,
      processGroupId: stat.processGroupId,
      startTimeTicks: stat.startTimeTicks,
      state: stat.state
    }
  } catch {
    return null
  }
}

interface LinuxProcStat {
  pid: number
  state: string
  processGroupId: number
  startTimeTicks: string
}

function parseLinuxProcStat(value: string): LinuxProcStat | null {
  const commandStart = value.indexOf("(")
  const commandEnd = value.lastIndexOf(")")
  if (commandStart <= 0 || commandEnd <= commandStart) return null

  const pid = Number(value.slice(0, commandStart).trim())
  const fields = value.slice(commandEnd + 1).trim().split(/\s+/)
  const state = fields[0]
  const processGroupId = Number(fields[2])
  const startTimeTicks = fields[19]

  if (
    !Number.isSafeInteger(pid)
    || pid <= 0
    || !state
    || !Number.isSafeInteger(processGroupId)
    || processGroupId <= 0
    || !startTimeTicks
    || !/^\d+$/.test(startTimeTicks)
  ) return null

  return { pid, state, processGroupId, startTimeTicks }
}

const isTerminalProcessState = (state: string): boolean =>
  TERMINAL_PROCESS_STATES.has(state)
