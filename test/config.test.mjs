import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { loadConfig } from "../dist/env.js"

const withTempConfig = (contents, callback) => {
  const cwd = mkdtempSync(join(tmpdir(), "codex-linear-config-"))
  writeFileSync(join(cwd, ".env.defaults"), contents)
  const restoreEnv = cleanEnv([
    "CODEX_LINEAR_CODEX_CWD",
    "CODEX_LINEAR_CODEX_EXEC_MODE",
    "CODEX_LINEAR_REVIEWER_LABELS",
    "CODEX_LINEAR_STATE_DIR",
    "CODEX_LINEAR_WAIT_TIMEOUT_SECONDS"
  ])

  try {
    return callback(cwd)
  } finally {
    restoreEnv()
    rmSync(cwd, { recursive: true, force: true })
  }
}

const cleanEnv = (keys) => {
  const original = new Map(keys.map((key) => [key, process.env[key]]))
  keys.forEach((key) => delete process.env[key])

  return () => {
    keys.forEach((key) => {
      const value = original.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
}

test("config defaults Codex execution mode to attached", () => {
  withTempConfig("LINEAR_API_KEY=test-key\n", (cwd) => {
    const config = loadConfig({ envFiles: [], flags: {} }, cwd)

    assert.equal(config.codexExecMode, "attached")
    assert.equal(config.waitTimeoutMs, 60_000)
  })
})

test("config accepts explicit detached execution mode and wait timeout", () => {
  withTempConfig("LINEAR_API_KEY=test-key\n", (cwd) => {
    const config = loadConfig({
      envFiles: [],
      flags: {
        "codex-exec-mode": "detached",
        "wait-timeout-seconds": "7"
      }
    }, cwd)

    assert.equal(config.codexExecMode, "detached")
    assert.equal(config.waitTimeoutMs, 7_000)
  })
})

test("review config defaults to separate state, reviewer labels, and review statuses", () => {
  withTempConfig([
    "LINEAR_API_KEY=test-key",
    "CODEX_LINEAR_AGENT_ID=daedalus"
  ].join("\n"), (cwd) => {
    const restoreEnv = cleanEnv(["HOME"])
    process.env.HOME = join(cwd, "my-user")

    try {
      const config = loadConfig({ envFiles: [], flags: {} }, cwd, "review")

      assert.equal(config.stateDir, join(cwd, "my-user", ".local", "state", "codex-linear-review-delegator"))
      assert.deepEqual(config.reviewerLabels, ["reviewer:daedalus", "reviewer:any"])
      assert.equal(config.reviewReadyStatus, "In Review")
      assert.equal(config.reviewRunningStatus, "In Testing")
      assert.equal(config.reviewPassedStatus, "Review Passed")
      assert.equal(config.reviewReturnStatus, "Waiting For Agent")
    } finally {
      restoreEnv()
    }
  })
})

test("config expands home placeholders for local paths", () => {
  withTempConfig([
    "LINEAR_API_KEY=test-key",
    "CODEX_LINEAR_CODEX_CWD=$HOME",
    "CODEX_LINEAR_STATE_DIR=${HOME}/.local/state/codex-linear-work-delegator"
  ].join("\n"), (cwd) => {
    const restoreEnv = cleanEnv(["HOME"])
    process.env.HOME = join(cwd, "my-user")

    try {
      const config = loadConfig({ envFiles: [], flags: {} }, cwd)

      assert.equal(config.codexCwd, join(cwd, "my-user"))
      assert.equal(config.stateDir, join(cwd, "my-user", ".local", "state", "codex-linear-work-delegator"))
    } finally {
      restoreEnv()
    }
  })
})

test("config rejects unknown Codex execution modes", () => {
  withTempConfig([
    "LINEAR_API_KEY=test-key",
    "CODEX_LINEAR_CODEX_EXEC_MODE=background"
  ].join("\n"), (cwd) => {
    assert.throws(
      () => loadConfig({ envFiles: [], flags: {} }, cwd),
      /CODEX_LINEAR_CODEX_EXEC_MODE must be "attached" or "detached"/
    )
  })
})
