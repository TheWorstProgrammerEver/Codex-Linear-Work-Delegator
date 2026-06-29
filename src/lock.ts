import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Config } from "./env/types.js"

export interface LockHandle {
  release(): void
}

export function acquireLock(config: Config): LockHandle | null {
  const lockDir = join(config.stateDir, "claim.lock")
  mkdirSync(dirname(lockDir), { recursive: true })

  try {
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, "owner.json"), JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    }, null, 2))
    return {
      release: () => rmSync(lockDir, { recursive: true, force: true })
    }
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    if (!isStale(lockDir, config.lockStaleMs)) return null
    rmSync(lockDir, { recursive: true, force: true })
    return acquireLock(config)
  }
}

function isStale(lockDir: string, staleMs: number): boolean {
  if (staleMs <= 0) return false
  try {
    const owner = JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8")) as { acquiredAt?: string }
    if (!owner.acquiredAt) return false
    return Date.now() - Date.parse(owner.acquiredAt) > staleMs
  } catch {
    return false
  }
}

const isAlreadyExists = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"
