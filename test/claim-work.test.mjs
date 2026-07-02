import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { checkAbandonedRunningWork, getAbandonedRunningWorkWarnings } from "../dist/claim-work/abandoned-running-work.js"
import { claimNextIssue } from "../dist/claim-work/claim-next-issue.js"

test("claim exits early when local worker state is busy", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-busy-"))
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, "current.json"), JSON.stringify({
    issueId: "issue-1",
    identifier: "RYA-1",
    url: "https://linear.app/example/RYA-1",
    pid: process.pid,
    model: "gpt-5.5",
    startedAt: new Date().toISOString(),
    logFile: join(stateDir, "worker.log")
  }))

  const logs = []
  const originalLog = console.log
  console.log = (message) => logs.push(String(message))

  try {
    const result = await claimNextIssue(baseConfig({ stateDir }))

    assert.equal(result, null)
    assert.match(logs.join("\n"), /Worker is busy with RYA-1 pid=/)
  } finally {
    console.log = originalLog
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("startup health check comments on abandoned direct-agent running work", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-health-"))
  const comments = []
  const issue = linearIssue({
    labels: [agentLabel("daedalus")],
    comments: []
  })

  try {
    const count = await checkAbandonedRunningWork(baseConfig({ stateDir }), {
      getRunningIssues: async () => [issue],
      getIssue: async () => issue,
      createComment: async (issueId, body) => comments.push({ issueId, body })
    })

    assert.equal(count, 1)
    assert.equal(comments[0].issueId, "issue-1")
    assert.match(comments[0].body, /Startup health check:/)
    assert.match(comments[0].body, /I am not changing status, killing processes, or assuming failure/)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("abandoned-work warning logic skips active and already-warned issues", () => {
  const config = baseConfig()
  const active = linearIssue({
    id: "active",
    identifier: "RYA-2",
    labels: [agentLabel("daedalus")]
  })
  const alreadyWarned = linearIssue({
    id: "warned",
    identifier: "RYA-3",
    labels: [agentLabel("daedalus")],
    comments: [comment("Startup health check: already warned.")]
  })

  const warnings = getAbandonedRunningWorkWarnings(
    config,
    { issueId: "active", identifier: "RYA-2" },
    [active, alreadyWarned]
  )

  assert.deepEqual(warnings, [])
})

test("startup health check only warns once for abandoned work", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-health-warned-"))
  const comments = []
  const issue = linearIssue({
    labels: [agentLabel("daedalus")],
    comments: [comment("Startup health check: already warned.")]
  })

  try {
    const count = await checkAbandonedRunningWork(baseConfig({ stateDir }), {
      getRunningIssues: async () => [issue],
      getIssue: async () => issue,
      createComment: async (issueId, body) => comments.push({ issueId, body })
    })

    assert.equal(count, 0)
    assert.deepEqual(comments, [])
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("agent:any warning uses latest claim comment owner", () => {
  const config = baseConfig()
  const claimedByThisAgent = linearIssue({
    id: "claimed-by-this-agent",
    labels: [agentLabel("any")],
    comments: [
      comment("Claimed by other at 2026-06-29T09:00:00.000Z.", "2026-06-29T09:00:00.000Z"),
      comment("Claimed by daedalus at 2026-06-29T10:00:00.000Z.", "2026-06-29T10:00:00.000Z")
    ]
  })
  const claimedByAnotherAgent = linearIssue({
    id: "claimed-by-another-agent",
    labels: [agentLabel("any")],
    comments: [
      comment("Claimed by daedalus at 2026-06-29T09:00:00.000Z.", "2026-06-29T09:00:00.000Z"),
      comment("Claimed by other at 2026-06-29T10:00:00.000Z.", "2026-06-29T10:00:00.000Z")
    ]
  })

  const warnings = getAbandonedRunningWorkWarnings(
    config,
    null,
    [claimedByThisAgent, claimedByAnotherAgent]
  )

  assert.deepEqual(warnings.map((issue) => issue.id), ["claimed-by-this-agent"])
})

test("claim skips blocked candidates and claims the next eligible issue", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-dependency-"))
  const blocked = linearIssue({
    id: "blocked",
    identifier: "RYA-1",
    state: workflowState("ready", "Waiting For Agent", "unstarted"),
    labels: [agentLabel("daedalus")],
    inverseRelations: [
      blocksRelation(
        dependencyIssue("RYA-0", workflowState("running", "Agent In Progress", "started")),
        "RYA-1"
      )
    ]
  })
  const claimable = linearIssue({
    id: "claimable",
    identifier: "RYA-2",
    state: workflowState("ready", "Waiting For Agent", "unstarted"),
    labels: [agentLabel("daedalus")]
  })
  const comments = []
  const updates = []
  const logs = []
  const originalFetch = globalThis.fetch
  const originalLog = console.log
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.query.includes("query CandidateIssues")) {
      return jsonResponse({ data: { issues: { nodes: [blocked, claimable] } } })
    }
    if (body.query.includes("query WorkflowStates")) {
      return jsonResponse({
        data: {
          workflowStates: {
            nodes: [workflowState("running", "Agent In Progress", "started", claimable.team)]
          }
        }
      })
    }
    if (body.query.includes("mutation IssueUpdate")) {
      updates.push(body.variables)
      return jsonResponse({
        data: {
          issueUpdate: {
            success: true,
            issue: {
              id: "claimable",
              identifier: "RYA-2",
              state: workflowState("running", "Agent In Progress", "started")
            }
          }
        }
      })
    }
    if (body.query.includes("mutation CommentCreate")) {
      comments.push(body.variables.input)
      return jsonResponse({ data: { commentCreate: { success: true, comment: { id: "comment-1" } } } })
    }
    if (body.query.includes("query GetIssue")) {
      return jsonResponse({
        data: {
          issue: {
            ...claimable,
            state: workflowState("running", "Agent In Progress", "started")
          }
        }
      })
    }
    throw new Error(`Unexpected query: ${body.query}`)
  }
  console.log = (message) => logs.push(String(message))

  try {
    const result = await claimNextIssue(baseConfig({ stateDir }))

    assert.equal(result.identifier, "RYA-2")
    assert.deepEqual(updates.map((update) => update.id), ["claimable"])
    assert.equal(comments.length, 1)
    assert.match(logs.join("\n"), /Skipping RYA-1; blocked by unresolved dependencies: RYA-0/)
    assert.match(logs.join("\n"), /Selected RYA-2/)
  } finally {
    globalThis.fetch = originalFetch
    console.log = originalLog
    rmSync(stateDir, { recursive: true, force: true })
  }
})

const baseConfig = (overrides = {}) => ({
  linearApiKey: "test-key",
  linearApiUrl: "https://linear.example/graphql",
  agentId: "daedalus",
  agentLabels: ["agent:daedalus", "agent:any"],
  readyStatus: "Waiting For Agent",
  runningStatus: "Agent In Progress",
  blockedStatus: "Blocked",
  reviewStatus: "In Review",
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
  ...overrides
})

const linearIssue = ({
  id = "issue-1",
  identifier = "RYA-1",
  labels = [],
  comments = [],
  state = workflowState("state-1", "Agent In Progress", "started"),
  relations = [],
  inverseRelations = []
} = {}) => ({
  id,
  identifier,
  title: "Test issue",
  url: `https://linear.app/example/${identifier}`,
  priority: 2,
  createdAt: "2026-06-29T09:00:00.000Z",
  updatedAt: "2026-06-29T09:00:00.000Z",
  state,
  labels: { nodes: labels },
  comments: { nodes: comments },
  relations: { nodes: relations },
  inverseRelations: { nodes: inverseRelations },
  team: { id: "team-1", key: "RYA", name: "Ryan Hayward" }
})

const agentLabel = (name) => ({
  id: `agent-${name}`,
  name,
  parent: { id: "agent", name: "agent" }
})

const comment = (body, createdAt = "2026-06-29T09:00:00.000Z") => ({
  id: `comment-${createdAt}`,
  body,
  createdAt,
  updatedAt: createdAt
})

const workflowState = (id, name, type, team = null) => ({ id, name, type, team })

const blocksRelation = (sourceIssue, targetIdentifier) => ({
  id: `relation-${sourceIssue.identifier}-${targetIdentifier}`,
  type: "blocks",
  issue: sourceIssue,
  relatedIssue: dependencyIssue(targetIdentifier, workflowState("ready", "Waiting For Agent", "unstarted"))
})

const dependencyIssue = (identifier, state) => ({
  identifier,
  title: `Issue ${identifier}`,
  url: `https://linear.app/example/${identifier}`,
  state
})

const jsonResponse = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })
