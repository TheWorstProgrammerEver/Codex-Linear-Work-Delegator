import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

test("schedule installer generates a single-worker attached systemd service", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-linear-systemd-"))
  const systemdDir = join(root, "systemd")
  const envFile = join(root, "worker.env")
  writeFileSync(envFile, "LINEAR_API_KEY=test-key\n")

  try {
    const result = spawnSync("bash", ["scripts/install-schedule.sh"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ENV_FILE: envFile,
        NPM_BIN: process.execPath,
        SYSTEMCTL_BIN: "true",
        SYSTEMD_DIR: systemdDir,
        TARGET_USER: userInfo().username
      },
      encoding: "utf8"
    })

    assert.equal(result.status, 0, result.stderr || result.stdout)

    const service = readFileSync(join(systemdDir, "codex-linear-work-delegator.service"), "utf8")
    const timer = readFileSync(join(systemdDir, "codex-linear-work-delegator.timer"), "utf8")

    assert.match(service, /^Type=oneshot$/m)
    assert.match(service, /^TimeoutStartSec=infinity$/m)
    assert.match(service, /^KillMode=control-group$/m)
    assert.match(service, new RegExp(`^ExecStart=${escapeRegExp(process.execPath)} start -- --env-file ${escapeRegExp(envFile)}$`, "m"))
    assert.doesNotMatch(service, /--wait-timeout-seconds/)
    assert.match(timer, /^OnUnitInactiveSec=5min$/m)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const escapeRegExp = (input) => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
