import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { spawnCodexForIssue } from "../dist/codex/spawn.js"
import { waitForChildOrTimeout } from "../dist/codex/wait.js"

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

const exitedChild = () => {
  const child = new EventEmitter()
  child.exitCode = 0
  child.signalCode = null
  child.unref = () => {}
  return child
}

const baseConfig = (overrides = {}) => ({
  linearApiKey: "test-key",
  linearApiUrl: "https://linear.example/graphql",
  agentId: "daedalus",
  agentLabels: ["agent:daedalus", "agent:any"],
  reviewerLabels: ["reviewer:daedalus", "reviewer:any"],
  readyStatus: "Waiting For Agent",
  runningStatus: "Agent In Progress",
  blockedStatus: "Blocked",
  reviewStatus: "In Review",
  reviewReadyStatus: "In Review",
  reviewRunningStatus: "In Testing",
  reviewPassedStatus: "In Progress",
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
