import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { it } from "node:test"
import { setTimeout as delay } from "node:timers/promises"

it("a duplicate invocation exits as locked without touching steward state", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-reset-lock-test-"))
  const lockFile = join(root, "steward.lock")
  const readyFile = join(root, "ready")
  const holder = spawn(
    "flock",
    [
      "--nonblock",
      lockFile,
      process.execPath,
      "-e",
      "require('node:fs').writeFileSync(process.argv[1], 'ready'); setTimeout(() => {}, 750)",
      readyFile
    ],
    { stdio: "ignore" }
  )

  try {
    const deadline = Date.now() + 500
    while (!existsSync(readyFile) && Date.now() < deadline) await delay(10)
    assert.equal(existsSync(readyFile), true)

    const policyPath = new URL("../config/policy.default.json", import.meta.url).pathname
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "run"],
      {
        cwd: new URL("..", import.meta.url).pathname,
        encoding: "utf8",
        env: {
          ...process.env,
          CODEX_RESET_STEWARD_POLICY: policyPath,
          CODEX_RESET_STEWARD_STATE_DIR: join(root, "state"),
          CODEX_RESET_STEWARD_LOCK_FILE: lockFile
        },
        timeout: 2_000
      }
    )
    assert.equal(result.status, 0)
    assert.equal(result.stdout.trim(), "result=locked")
    assert.equal(existsSync(join(root, "state")), false)
  } finally {
    await new Promise<void>((resolve) => {
      if (holder.exitCode !== null || holder.signalCode !== null) resolve()
      else holder.once("close", () => resolve())
    })
    rmSync(root, { recursive: true, force: true })
  }
})
