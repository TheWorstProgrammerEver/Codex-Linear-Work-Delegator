import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Config } from "./env/types.js"

export interface CurrentState {
  issueId: string
  identifier: string
  url: string
  pid: number
  model: string
  startedAt: string
  logFile: string
}

export function getCurrentState(config: Config): CurrentState | null {
  const file = currentStatePath(config)
  if (!existsSync(file)) return null
  const state = JSON.parse(readFileSync(file, "utf8")) as CurrentState
  if (isProcessAlive(state.pid)) return state
  rmSync(file, { force: true })
  return null
}

export function writeCurrentState(config: Config, state: CurrentState): void {
  mkdirSync(config.stateDir, { recursive: true })
  writeFileSync(currentStatePath(config), JSON.stringify(state, null, 2))
}

export function clearCurrentState(config: Config, pid: number): void {
  const current = getCurrentState(config)
  if (!current || current.pid !== pid) return
  rmSync(currentStatePath(config), { force: true })
}

export const currentStatePath = (config: Config): string =>
  join(config.stateDir, "current.json")

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
