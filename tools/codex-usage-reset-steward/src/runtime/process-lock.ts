import { spawnSync } from "node:child_process"
import { dirname } from "node:path"
import { ensurePrivateDirectory } from "../state/steward-state.js"

const LOCKED_MARKER = "CODEX_RESET_STEWARD_LOCKED"

export function runUnderExclusiveLock(lockFile: string): number {
  if (process.env[LOCKED_MARKER] === "1") return -1
  ensurePrivateDirectory(dirname(lockFile))
  const result = spawnSync(
    "flock",
    [
      "--nonblock",
      "--conflict-exit-code", "75",
      lockFile,
      process.execPath,
      ...process.execArgv,
      ...process.argv.slice(1)
    ],
    {
      env: { ...process.env, [LOCKED_MARKER]: "1" },
      stdio: "inherit"
    }
  )
  if (result.error) return 70
  return result.status ?? 70
}
