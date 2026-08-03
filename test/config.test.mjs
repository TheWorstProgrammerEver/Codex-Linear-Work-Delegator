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
    "CODEX_LINEAR_AUTH_MODE",
    "CODEX_LINEAR_CODEX_CWD",
    "CODEX_LINEAR_CODEX_EXEC_MODE",
    "CODEX_LINEAR_OAUTH_SCOPES",
    "CODEX_LINEAR_OAUTH_TOKEN_CACHE_FILE",
    "CODEX_LINEAR_OAUTH_TOKEN_URL",
    "CODEX_LINEAR_REVIEWER_LABELS",
    "CODEX_LINEAR_STATE_DIR",
    "CODEX_LINEAR_USAGE_LIMIT_EVIDENCE_FILE",
    "CODEX_LINEAR_WAIT_TIMEOUT_SECONDS",
    "LINEAR_API_KEY",
    "LINEAR_OAUTH_CLIENT_ID",
    "LINEAR_OAUTH_CLIENT_SECRET"
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
    assert.deepEqual(config.linearAuth, { kind: "api-key", apiKey: "test-key" })
  })
})

test("config auto mode prefers complete OAuth client credentials over an API key", () => {
  withTempConfig([
    "LINEAR_API_KEY=fallback-key",
    "LINEAR_OAUTH_CLIENT_ID=test-client",
    "LINEAR_OAUTH_CLIENT_SECRET=test-secret"
  ].join("\n"), (cwd) => {
    const config = loadConfig({ envFiles: [], flags: {} }, cwd)

    assert.equal(config.linearAuth.kind, "oauth-client-credentials")
    assert.equal(config.linearAuth.clientId, "test-client")
    assert.equal(config.linearAuth.clientSecret, "test-secret")
    assert.deepEqual(config.linearAuth.scopes, ["read", "write"])
    assert.equal(config.linearAuth.tokenCacheFile, join(config.stateDir, "secrets", "linear-oauth-token.json"))
  })
})

test("config fails closed for partial OAuth credentials even when an API key exists", () => {
  withTempConfig([
    "LINEAR_API_KEY=fallback-key",
    "LINEAR_OAUTH_CLIENT_ID=test-client"
  ].join("\n"), (cwd) => {
    assert.throws(
      () => loadConfig({ envFiles: [], flags: {} }, cwd),
      /LINEAR_OAUTH_CLIENT_ID and LINEAR_OAUTH_CLIENT_SECRET must be configured together/
    )
  })
})

test("config can explicitly select API-key fallback when OAuth credentials are present", () => {
  withTempConfig([
    "CODEX_LINEAR_AUTH_MODE=api-key",
    "LINEAR_API_KEY=fallback-key",
    "LINEAR_OAUTH_CLIENT_ID=test-client",
    "LINEAR_OAUTH_CLIENT_SECRET=test-secret"
  ].join("\n"), (cwd) => {
    assert.deepEqual(loadConfig({ envFiles: [], flags: {} }, cwd).linearAuth, {
      kind: "api-key",
      apiKey: "fallback-key"
    })
  })
})

test("config rejects explicit OAuth mode without complete OAuth credentials", () => {
  withTempConfig([
    "CODEX_LINEAR_AUTH_MODE=oauth",
    "LINEAR_API_KEY=fallback-key"
  ].join("\n"), (cwd) => {
    assert.throws(
      () => loadConfig({ envFiles: [], flags: {} }, cwd),
      /OAuth mode requires LINEAR_OAUTH_CLIENT_ID and LINEAR_OAUTH_CLIENT_SECRET/
    )
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
      assert.equal(config.reviewRunningStatus, "Agent Reviewing")
      assert.equal(config.reviewPassedStatus, "Review Passed")
      assert.equal(config.reviewReturnStatus, "Waiting For Agent")
    } finally {
      restoreEnv()
    }
  })
})

test("committed defaults keep work and review state directories separate", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-linear-config-home-"))
  const restoreEnv = cleanEnv(["HOME", "LINEAR_API_KEY", "CODEX_LINEAR_STATE_DIR"])

  process.env.HOME = home
  process.env.LINEAR_API_KEY = "test-key"

  try {
    const work = loadConfig({ envFiles: [], flags: {} }, process.cwd(), "work")
    const review = loadConfig({ envFiles: [], flags: {} }, process.cwd(), "review")

    assert.equal(work.stateDir, join(home, ".local", "state", "codex-linear-work-delegator"))
    assert.equal(review.stateDir, join(home, ".local", "state", "codex-linear-review-delegator"))
    assert.equal(
      work.usageLimitEvidenceFile,
      join(home, ".local", "state", "codex-usage-reset-steward", "usage-limit-blocked.json")
    )
    assert.equal(review.usageLimitEvidenceFile, work.usageLimitEvidenceFile)
  } finally {
    restoreEnv()
    rmSync(home, { recursive: true, force: true })
  }
})

test("config expands home placeholders for local paths", () => {
  withTempConfig([
    "LINEAR_API_KEY=test-key",
    "CODEX_LINEAR_CODEX_CWD=$HOME",
    "CODEX_LINEAR_STATE_DIR=${HOME}/.local/state/codex-linear-work-delegator",
    "CODEX_LINEAR_USAGE_LIMIT_EVIDENCE_FILE=~/.local/state/codex-usage-reset-steward/usage-limit-blocked.json"
  ].join("\n"), (cwd) => {
    const restoreEnv = cleanEnv(["HOME"])
    process.env.HOME = join(cwd, "my-user")

    try {
      const config = loadConfig({ envFiles: [], flags: {} }, cwd)

      assert.equal(config.codexCwd, join(cwd, "my-user"))
      assert.equal(config.stateDir, join(cwd, "my-user", ".local", "state", "codex-linear-work-delegator"))
      assert.equal(
        config.usageLimitEvidenceFile,
        join(cwd, "my-user", ".local", "state", "codex-usage-reset-steward", "usage-limit-blocked.json")
      )
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
