import assert from "node:assert/strict"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  FileUsageLimitEvidenceStore,
  StructuredUsageLimitEvidenceLifecycle,
  buildUsageLimitEvidence,
  parseCodexExecThreadId,
  reconcileUsageLimitEvidence
} from "../dist/codex/usage-limit-evidence.js"
import {
  CodexThreadErrorReader,
  buildAppServerEnvironment,
  parseUsageLimitExceeded
} from "../dist/codex/thread-error-reader.js"

const NOW = new Date("2030-01-01T00:00:00.000Z")
const THREAD_ID = "0198a000-0000-7000-8000-000000000001"

test("uses only structured app-server evidence, never message text", () => {
  assert.equal(parseCodexExecThreadId([
    "warning: unrelated stderr",
    JSON.stringify({ type: "thread.started", thread_id: THREAD_ID })
  ].join("\n")), THREAD_ID)
  assert.equal(parseCodexExecThreadId(
    JSON.stringify({ type: "error", message: `usageLimitExceeded ${THREAD_ID}` })
  ), null)

  assert.equal(parseUsageLimitExceeded({
    thread: {
      id: THREAD_ID,
      turns: [{
        status: "failed",
        error: { message: "usageLimitExceeded", codexErrorInfo: "other" }
      }]
    }
  }, THREAD_ID), false)
  assert.equal(parseUsageLimitExceeded({
    thread: {
      id: THREAD_ID,
      turns: [{
        status: "failed",
        error: { message: "redacted", codexErrorInfo: "usageLimitExceeded" }
      }]
    }
  }, THREAD_ID), true)
})

test("reads the structured failed turn through the app-server thread contract", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-linear-thread-reader-"))
  const fakeCodex = join(root, "codex")
  writeFileSync(fakeCodex, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "while IFS= read -r request; do",
    "  case \"$request\" in",
    "    *'\"method\":\"initialize\"'*) printf '%s\\n' '{\"id\":1,\"result\":{}}' ;;",
    `    *'\"method\":\"thread/read\"'*) printf '%s\\n' '{"id":2,"result":{"thread":{"id":"${THREAD_ID}","turns":[{"status":"failed","error":{"message":"redacted","codexErrorInfo":"usageLimitExceeded"}}]}}}' ;;`,
    "  esac",
    "done"
  ].join("\n"))
  chmodSync(fakeCodex, 0o700)
  const reader = new CodexThreadErrorReader(fakeCodex, 2_000)

  try {
    assert.equal(await reader.hasUsageLimitExceeded(THREAD_ID), true)
  } finally {
    await reader.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test("publishes private bounded evidence only after structured error and current eligibility", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-linear-usage-evidence-"))
  const evidenceFile = join(root, "evidence", "usage-limit-blocked.json")
  const logFile = join(root, "codex.jsonl")
  const config = baseConfig(evidenceFile)
  const issue = linearIssue()
  const store = new FileUsageLimitEvidenceStore(evidenceFile)
  const lifecycle = new StructuredUsageLimitEvidenceLifecycle(
    config,
    { getIssue: async () => issue },
    store,
    () => ({
      hasUsageLimitExceeded: async (threadId) => threadId === THREAD_ID,
      close: async () => {}
    }),
    () => NOW
  )
  writeFileSync(logFile, `${JSON.stringify({ type: "thread.started", thread_id: THREAD_ID })}\n`)
  chmodSync(logFile, 0o600)

  try {
    const seeded = buildUsageLimitEvidence(config, issue, "work", NOW)
    assert.ok(seeded)
    store.publish(seeded)
    lifecycle.beforeLaunch()
    assert.equal(existsSync(evidenceFile), false)
    await lifecycle.afterExit(issue, "work", logFile)

    const serialized = readFileSync(evidenceFile, "utf8")
    const published = JSON.parse(serialized)
    assert.equal(statSync(join(root, "evidence")).mode & 0o777, 0o700)
    assert.equal(statSync(evidenceFile).mode & 0o777, 0o600)
    assert.equal(published.classifier, "usageLimitExceeded")
    assert.equal(published.source, "codex-app-server-v2-event")
    assert.equal(published.work.identifier, "RYA-217")
    assert.deepEqual(published.work.blockedBy, [])
    for (const prohibited of [
      "message", "description", "logFile", "threadId", "pid", "token", "credit"
    ]) assert.equal(serialized.includes(prohibited), false)

    const recoveredLifecycle = new StructuredUsageLimitEvidenceLifecycle(
      config,
      { getIssue: async () => issue },
      store,
      () => ({
        hasUsageLimitExceeded: async () => false,
        close: async () => {}
      }),
      () => NOW
    )
    await recoveredLifecycle.afterExit(issue, "work", logFile)
    assert.equal(existsSync(evidenceFile), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejects stale or unrelated work and invalidates evidence after Linear recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-linear-usage-reconcile-"))
  const evidenceFile = join(root, "evidence", "usage-limit-blocked.json")
  const config = baseConfig(evidenceFile)
  const store = new FileUsageLimitEvidenceStore(evidenceFile)
  const issue = linearIssue()

  try {
    assert.equal(buildUsageLimitEvidence(config, {
      ...issue,
      state: { id: "done", name: "Done", type: "completed" }
    }, "work", NOW), null)

    const reviewEvidence = buildUsageLimitEvidence(
      { ...config, agentId: "momus" },
      {
        ...issue,
        state: { id: "reviewing", name: "Agent Reviewing", type: "started" },
        labels: {
          nodes: [{
            id: "reviewer-momus",
            name: "momus",
            parent: { id: "reviewer", name: "reviewer" }
          }]
        }
      },
      "review",
      NOW
    )
    assert.equal(reviewEvidence?.purpose, "review")
    assert.equal(reviewEvidence?.work.state, "reviewing")
    assert.equal(buildUsageLimitEvidence(config, {
      ...issue,
      inverseRelations: {
        nodes: [{
          id: "relation-1",
          type: "blocks",
          issue: dependencyIssue("RYA-1", "Agent In Progress", "started"),
          relatedIssue: dependencyIssue("RYA-217", "Agent In Progress", "started")
        }]
      }
    }, "work", NOW), null)

    const valid = buildUsageLimitEvidence(config, issue, "work", NOW)
    assert.ok(valid)
    store.publish(valid)
    await reconcileUsageLimitEvidence(
      config,
      { getIssue: async () => ({ ...issue, state: { id: "done", name: "Done", type: "completed" } }) },
      store,
      new Date(NOW.getTime() + 60_000)
    )
    assert.equal(existsSync(evidenceFile), false)

    store.publish(valid)
    await reconcileUsageLimitEvidence(
      config,
      { getIssue: async () => issue },
      store,
      new Date(NOW.getTime() + 16 * 60_000)
    )
    assert.equal(existsSync(evidenceFile), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("app-server verifier environment excludes Linear and unrelated credentials", () => {
  const originalLinear = process.env.LINEAR_API_KEY
  const originalHome = process.env.HOME
  process.env.LINEAR_API_KEY = "EXAMPLE_LINEAR_SECRET"
  process.env.HOME = "/fixture/home"
  try {
    const environment = buildAppServerEnvironment()
    assert.equal(environment.HOME, "/fixture/home")
    assert.equal("LINEAR_API_KEY" in environment, false)
  } finally {
    if (originalLinear === undefined) delete process.env.LINEAR_API_KEY
    else process.env.LINEAR_API_KEY = originalLinear
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
  }
})

const baseConfig = (evidenceFile) => ({
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
  reviewRunningStatus: "Agent Reviewing",
  reviewPassedStatus: "Review Passed",
  reviewReturnStatus: "Waiting For Agent",
  defaultModel: "gpt-5.5",
  defaultSandbox: "danger-full-access",
  codexBin: "codex",
  codexCwd: process.cwd(),
  codexExecMode: "attached",
  codexExtraArgs: [],
  stateDir: join(tmpdir(), "codex-linear-unused-state"),
  usageLimitEvidenceFile: evidenceFile,
  waitTimeoutMs: 60_000,
  lockStaleMs: 600_000,
  fetchLimit: 50,
  dryRun: false,
  noSpawn: false,
  advise: false
})

const linearIssue = () => ({
  id: "issue-217",
  identifier: "RYA-217",
  title: "Fixture",
  url: "https://linear.example/RYA-217",
  description: "must never enter evidence",
  priority: 2,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  state: { id: "running", name: "Agent In Progress", type: "started" },
  labels: {
    nodes: [{
      id: "agent-daedalus",
      name: "daedalus",
      parent: { id: "agent", name: "agent" }
    }]
  },
  team: { id: "team-1", key: "RYA", name: "Ryan Hayward" },
  relations: { nodes: [] },
  inverseRelations: { nodes: [] }
})

const dependencyIssue = (identifier, name, type) => ({
  identifier,
  title: "Dependency",
  url: `https://linear.example/${identifier}`,
  state: { id: `${identifier}-state`, name, type }
})
