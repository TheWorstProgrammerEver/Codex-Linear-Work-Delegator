import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { it } from "node:test"

it("builds the install release from the reviewed Git tree, not ignored dist output", () => {
  const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
  const poison = join(packageRoot, "dist", "ignored-poison-marker")
  const temporaryRoot = mkdtempSync(join(tmpdir(), "codex-reset-reviewed-build-"))
  const output = join(temporaryRoot, "source")
  mkdirSync(dirname(poison), { recursive: true })
  writeFileSync(poison, "unreviewed-output-must-not-ship\n")
  try {
    const treeish = execFileSync("git", ["write-tree"], {
      cwd: packageRoot,
      encoding: "utf8"
    }).trim()
    const result = spawnSync(
      "bash",
      ["scripts/build-reviewed-release.sh", output, treeish],
      { cwd: packageRoot, encoding: "utf8", timeout: 30_000, maxBuffer: 1_048_576 }
    )
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(existsSync(join(output, "dist", "ignored-poison-marker")), false)
    assert.equal(existsSync(join(output, "dist", "src", "cli.js")), true)
  } finally {
    rmSync(poison, { force: true })
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

it("re-arms the timer on both dry-run and consume installation passes", () => {
  const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
  const temporaryRoot = mkdtempSync(join(tmpdir(), "codex-reset-timer-"))
  const fakeSystemctl = join(temporaryRoot, "systemctl")
  const stateFile = join(temporaryRoot, "state")
  const callsFile = join(temporaryRoot, "calls")
  writeFileSync(fakeSystemctl, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "printf '%s\\n' \"$*\" >>\"$FAKE_CALLS_FILE\"",
    "case \"$1\" in",
    "  enable) test -e \"$FAKE_STATE_FILE\" || printf 'elapsed\\n' >\"$FAKE_STATE_FILE\" ;;",
    "  restart) printf 'waiting\\n' >\"$FAKE_STATE_FILE\" ;;",
    "esac"
  ].join("\n"))
  chmodSync(fakeSystemctl, 0o700)

  try {
    for (const pass of ["dry-run", "consume"]) {
      const result = spawnSync("bash", ["scripts/activate-timer.sh"], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          SYSTEMCTL_BIN: fakeSystemctl,
          TIMER_UNIT: `codex-usage-reset-steward.timer`,
          FAKE_STATE_FILE: stateFile,
          FAKE_CALLS_FILE: callsFile,
          INSTALL_PASS: pass
        }
      })
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.equal(readFileSync(stateFile, "utf8"), "waiting\n")
    }

    const calls = readFileSync(callsFile, "utf8").trim().split("\n")
    assert.deepEqual(calls, [
      "daemon-reload",
      "enable codex-usage-reset-steward.timer",
      "restart codex-usage-reset-steward.timer",
      "reset-failed codex-usage-reset-steward.timer",
      "daemon-reload",
      "enable codex-usage-reset-steward.timer",
      "restart codex-usage-reset-steward.timer",
      "reset-failed codex-usage-reset-steward.timer"
    ])
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
