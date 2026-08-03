import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { buildCodexEnvironment, spawnCodexForIssue, spawnCodexForReview } from "../dist/codex/spawn.js"
import { waitForChildOrTimeout } from "../dist/codex/wait.js"
import { readReviewRunRecord, recoverExitedReviewState } from "../dist/review/run-record.js"

test("spawn failure rejects without writing pid -1 current state", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-spawn-"))
  const config = baseConfig({
    codexBin: join(stateDir, "missing-codex"),
    stateDir
  })

  try {
    await assert.rejects(
      () => spawnCodexForIssue(config, linearIssue()),
      /ENOENT/
    )

    assert.equal(existsSync(join(stateDir, "current.json")), false)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("attached wait clears state when child already exited before listener registration", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-exited-"))
  const config = baseConfig({ stateDir })
  writeFileSync(join(stateDir, "current.json"), JSON.stringify({
    issueId: "issue-1",
    identifier: "RYA-1",
    url: "https://linear.app/example/RYA-1",
    pid: process.pid,
    model: "gpt-5.5",
    startedAt: new Date().toISOString(),
    logFile: join(stateDir, "worker.log")
  }))

  try {
    await waitForChildOrTimeout(config, process.pid, exitedChild())

    assert.equal(existsSync(join(stateDir, "current.json")), false)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("spawned review inherits CODEX_GITHUB_ENV for Momus GitHub helpers", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-review-env-"))
  const codexBin = join(stateDir, "fake-codex")
  const githubEnv = join(stateDir, "momus.env")
  const restoreEnv = cleanEnv(["CODEX_GITHUB_ENV"])

  writeFileSync(codexBin, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "printf 'CODEX_GITHUB_ENV=%s\\n' \"${CODEX_GITHUB_ENV:-}\""
  ].join("\n"))
  chmodSync(codexBin, 0o700)
  writeFileSync(githubEnv, "# non-secret test profile path\n")
  process.env.CODEX_GITHUB_ENV = githubEnv

  try {
    await spawnCodexForReview(baseConfig({ codexBin, stateDir }), linearIssue())

    const [logName] = readdirSync(join(stateDir, "logs"))
    const log = readFileSync(join(stateDir, "logs", logName), "utf8")
    assert.equal(log.trim(), `CODEX_GITHUB_ENV=${githubEnv}`)
  } finally {
    restoreEnv()
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("spawn environment strips long-lived Linear credentials and passes only an explicit app bearer token", () => {
  const restoreEnv = cleanEnv([
    "CODEX_LINEAR_MCP_BEARER_TOKEN",
    "LINEAR_API_KEY",
    "LINEAR_OAUTH_CLIENT_ID",
    "LINEAR_OAUTH_CLIENT_SECRET",
    "PATH"
  ])
  process.env.CODEX_LINEAR_MCP_BEARER_TOKEN = "stale-bearer"
  process.env.LINEAR_API_KEY = "personal-api-key"
  process.env.LINEAR_OAUTH_CLIENT_ID = "client-id"
  process.env.LINEAR_OAUTH_CLIENT_SECRET = "client-secret"
  process.env.PATH = "/fixture/bin"

  try {
    const environment = buildCodexEnvironment("fresh-app-bearer")
    assert.equal(environment.PATH, "/fixture/bin")
    assert.equal(environment.CODEX_LINEAR_MCP_BEARER_TOKEN, "fresh-app-bearer")
    assert.equal("LINEAR_API_KEY" in environment, false)
    assert.equal("LINEAR_OAUTH_CLIENT_ID" in environment, false)
    assert.equal("LINEAR_OAUTH_CLIENT_SECRET" in environment, false)

    const fallbackEnvironment = buildCodexEnvironment()
    assert.equal("CODEX_LINEAR_MCP_BEARER_TOKEN" in fallbackEnvironment, false)
  } finally {
    restoreEnv()
  }
})

test("spawn lifecycle clears stale evidence and observes the completed run", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-evidence-lifecycle-"))
  const codexBin = join(stateDir, "fake-codex")
  const calls = []
  writeFileSync(codexBin, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"0198a000-0000-7000-8000-000000000001\"}'"
  ].join("\n"))
  chmodSync(codexBin, 0o700)

  try {
    await spawnCodexForIssue(baseConfig({ codexBin, stateDir }), linearIssue(), {
      beforeLaunch: () => calls.push(["before"]),
      afterExit: async (issue, purpose, logFile) => {
        calls.push(["after", issue.identifier, purpose, existsSync(logFile)])
      }
    })

    assert.deepEqual(calls, [
      ["before"],
      ["after", "RYA-1", "work", true]
    ])
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("review child exit preserves bounded evidence without storing log content", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-review-exit-"))
  const codexBin = join(stateDir, "fake-codex")
  const evidence = "required-change evidence that must stay in the local log"

  writeFileSync(codexBin, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `printf '%s\\n' '${evidence}'`,
    "exit 17"
  ].join("\n"))
  chmodSync(codexBin, 0o700)

  try {
    await spawnCodexForReview(baseConfig({ codexBin, stateDir }), linearIssue())

    const record = readReviewRunRecord(baseConfig({ stateDir }), "issue-1")
    assert.equal(record.classification, "exited-with-evidence")
    assert.equal(record.exitCode, 17)
    assert.equal(record.signal, null)
    assert.ok(record.logEvidence.byteCount > 0)
    assert.match(record.logEvidence.tailSha256, /^[a-f0-9]{64}$/)
    assert.ok(record.logEvidence.sampledTailBytes <= 16 * 1024)
    assert.doesNotMatch(JSON.stringify(record), new RegExp(evidence))
    assert.equal(existsSync(join(stateDir, "current.json")), false)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("startup records evidence when a detached review process disappeared", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-review-missing-"))
  const config = baseConfig({ codexExecMode: "detached", stateDir })
  const logFile = join(stateDir, "review.log")
  const evidence = "review evidence written before the detached process disappeared"

  writeFileSync(logFile, evidence)
  writeFileSync(join(stateDir, "current.json"), JSON.stringify({
    issueId: "issue-1",
    identifier: "RYA-1",
    url: "https://linear.app/example/RYA-1",
    pid: 2_147_483_647,
    model: "gpt-5.5",
    startedAt: new Date().toISOString(),
    logFile,
    purpose: "review"
  }))

  try {
    assert.equal(recoverExitedReviewState(config), null)

    const record = readReviewRunRecord(config, "issue-1")
    assert.equal(record.classification, "process-missing-with-evidence")
    assert.equal(record.exitCode, null)
    assert.ok(record.logEvidence.byteCount > 0)
    assert.doesNotMatch(JSON.stringify(record), new RegExp(evidence))
    assert.equal(existsSync(join(stateDir, "current.json")), false)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("startup treats a reused review PID as exited", () => {
  const fixture = recoveryFixture("codex-linear-review-pid-reuse-")
  const currentObservation = {
    ...fixture.processIdentity,
    startTimeTicks: "200",
    state: "S"
  }

  try {
    assert.equal(recoverExitedReviewState(fixture.config, () => currentObservation), null)
    assert.equal(readReviewRunRecord(fixture.config, "issue-1").classification, "process-missing-with-evidence")
    assert.equal(existsSync(join(fixture.stateDir, "current.json")), false)
  } finally {
    rmSync(fixture.stateDir, { recursive: true, force: true })
  }
})

test("startup treats an unreaped zombie review child as exited", () => {
  const fixture = recoveryFixture("codex-linear-review-zombie-")
  const zombieObservation = {
    ...fixture.processIdentity,
    state: "Z"
  }

  try {
    assert.equal(recoverExitedReviewState(fixture.config, () => zombieObservation), null)
    assert.equal(readReviewRunRecord(fixture.config, "issue-1").classification, "process-missing-with-evidence")
    assert.equal(existsSync(join(fixture.stateDir, "current.json")), false)
  } finally {
    rmSync(fixture.stateDir, { recursive: true, force: true })
  }
})

test("startup treats a dead review process leader as exited", () => {
  const fixture = recoveryFixture("codex-linear-review-dead-")
  const deadObservation = {
    ...fixture.processIdentity,
    state: "X"
  }

  try {
    assert.equal(recoverExitedReviewState(fixture.config, () => deadObservation), null)
    assert.equal(readReviewRunRecord(fixture.config, "issue-1").classification, "process-missing-with-evidence")
    assert.equal(existsSync(join(fixture.stateDir, "current.json")), false)
  } finally {
    rmSync(fixture.stateDir, { recursive: true, force: true })
  }
})

test("startup keeps an exact live review process identity busy", () => {
  const fixture = recoveryFixture("codex-linear-review-live-")
  const liveObservation = {
    ...fixture.processIdentity,
    state: "S"
  }

  try {
    assert.equal(recoverExitedReviewState(fixture.config, () => liveObservation)?.identifier, "RYA-1")
    assert.equal(readReviewRunRecord(fixture.config, "issue-1"), null)
    assert.equal(existsSync(join(fixture.stateDir, "current.json")), true)
  } finally {
    rmSync(fixture.stateDir, { recursive: true, force: true })
  }
})

const recoveryFixture = (prefix) => {
  const stateDir = mkdtempSync(join(tmpdir(), prefix))
  const config = baseConfig({ codexExecMode: "detached", stateDir })
  const logFile = join(stateDir, "review.log")
  const processIdentity = {
    platform: "linux",
    bootId: "test-boot",
    pid: 41_000,
    processGroupId: 41_000,
    startTimeTicks: "100"
  }

  writeFileSync(logFile, "bounded review evidence")
  writeFileSync(join(stateDir, "current.json"), JSON.stringify({
    issueId: "issue-1",
    identifier: "RYA-1",
    url: "https://linear.app/example/RYA-1",
    pid: processIdentity.pid,
    model: "gpt-5.5",
    startedAt: new Date().toISOString(),
    logFile,
    purpose: "review",
    processIdentity
  }))

  return { config, processIdentity, stateDir }
}

const exitedChild = () => {
  const child = new EventEmitter()
  child.exitCode = 0
  child.signalCode = null
  child.unref = () => {}
  return child
}

const baseConfig = (overrides = {}) => ({
  linearAuth: { kind: "api-key", apiKey: "test-key" },
  linearApiUrl: "https://linear.example/graphql",
  agentId: "daedalus",
  agentLabels: ["agent:daedalus", "agent:any"],
  reviewerLabels: ["reviewer:daedalus", "reviewer:any"],
  readyStatus: "Waiting For Agent",
  runningStatus: "Agent In Progress",
  blockedStatus: "Blocked",
  reviewStatus: "In Review",
  reviewReadyStatus: "In Review",
  reviewRunningStatus: "Agent Reviewing",
  reviewPassedStatus: "Review Passed",
  reviewReturnStatus: "Waiting For Agent",
  defaultModel: "gpt-5.5",
  defaultSandbox: "danger-full-access",
  codexBin: "codex",
  codexCwd: process.cwd(),
  codexExecMode: "attached",
  codexExtraArgs: [],
  stateDir: join(tmpdir(), "codex-linear-test-unused-state"),
  waitTimeoutMs: 60_000,
  lockStaleMs: 600_000,
  fetchLimit: 50,
  dryRun: false,
  noSpawn: false,
  advise: false,
  ...overrides
})

const linearIssue = () => ({
  id: "issue-1",
  identifier: "RYA-1",
  title: "Test issue",
  url: "https://linear.app/example/RYA-1",
  description: "Test work",
  priority: 2,
  createdAt: "2026-06-29T09:00:00.000Z",
  updatedAt: "2026-06-29T09:00:00.000Z",
  state: { id: "state-1", name: "Agent In Progress" },
  labels: { nodes: [] },
  comments: { nodes: [] },
  team: { id: "team-1", key: "RYA", name: "Ryan Hayward" }
})

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
