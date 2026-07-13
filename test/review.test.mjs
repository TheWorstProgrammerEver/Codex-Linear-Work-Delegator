import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { checkAbandonedReview, getAbandonedReviewWarnings } from "../dist/review/abandoned-review.js"
import { claimNextReview } from "../dist/review/claim-next-review.js"
import { buildReviewPrompt } from "../dist/review/prompt.js"

test("startup health check comments on abandoned in-progress reviews", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-review-health-"))
  const comments = []
  const issue = linearIssue({
    labels: [reviewerLabel("daedalus")],
    state: workflowState("reviewing", "Agent Reviewing", "started"),
    comments: []
  })

  try {
    const count = await checkAbandonedReview(baseConfig({ stateDir }), {
      getReviewRunningIssues: async () => [issue],
      getIssue: async () => issue,
      createComment: async (issueId, body) => comments.push({ issueId, body })
    })

    assert.equal(count, 1)
    assert.equal(comments[0].issueId, "issue-1")
    assert.match(comments[0].body, /Review startup health check:/)
    assert.match(comments[0].body, /still in Agent Reviewing/)
    assert.match(comments[0].body, /move the issue back to In Review/)
    assert.match(comments[0].body, /I am not changing status, killing processes, or assuming failure/)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("review health check skips active and already-warned reviews", () => {
  const config = baseConfig()
  const active = linearIssue({
    id: "active",
    identifier: "RYA-2",
    labels: [reviewerLabel("daedalus")]
  })
  const alreadyWarned = linearIssue({
    id: "warned",
    identifier: "RYA-3",
    labels: [reviewerLabel("daedalus")],
    comments: [comment("Review startup health check: already warned.")]
  })

  const warnings = getAbandonedReviewWarnings(
    config,
    { issueId: "active", identifier: "RYA-2" },
    [active, alreadyWarned]
  )

  assert.deepEqual(warnings, [])
})

test("review health check honors custom configured reviewer labels", () => {
  const config = baseConfig({
    agentId: "momus",
    reviewerLabels: ["reviewer:momus-pilot"]
  })
  const customLabelIssue = linearIssue({
    id: "custom-label",
    labels: [reviewerLabel("momus-pilot")]
  })
  const defaultAgentLabelIssue = linearIssue({
    id: "default-agent-label",
    labels: [reviewerLabel("momus")]
  })

  const warnings = getAbandonedReviewWarnings(
    config,
    null,
    [customLabelIssue, defaultAgentLabelIssue]
  )

  assert.deepEqual(warnings.map((issue) => issue.id), ["custom-label"])
})

test("review health check is disabled in advise mode", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-review-advise-health-"))
  const calls = []

  try {
    const count = await checkAbandonedReview(baseConfig({ stateDir, advise: true }), {
      getReviewRunningIssues: async () => {
        calls.push(["getReviewRunningIssues"])
        return [linearIssue({ labels: [reviewerLabel("daedalus")] })]
      },
      getIssue: async () => {
        calls.push(["getIssue"])
        throw new Error("advise mode should not fetch review details")
      },
      createComment: async () => {
        calls.push(["createComment"])
        throw new Error("advise mode should not comment")
      }
    })

    assert.equal(count, 0)
    assert.deepEqual(calls, [])
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})


test("review claim skips blocked candidates and claims the next eligible review", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-review-"))
  const blocked = linearIssue({
    id: "blocked",
    identifier: "RYA-1",
    state: workflowState("review", "In Review", "started"),
    labels: [reviewerLabel("daedalus")],
    inverseRelations: [
      blocksRelation(
        dependencyIssue("RYA-0", workflowState("running", "Agent In Progress", "started")),
        "RYA-1"
      )
    ]
  })
  const missingReviewerLabel = linearIssue({
    id: "missing-reviewer",
    identifier: "RYA-2",
    state: workflowState("review", "In Review", "started"),
    labels: [agentLabel("daedalus")]
  })
  const wrongStatus = linearIssue({
    id: "wrong-status",
    identifier: "RYA-3",
    state: workflowState("ready", "Waiting For Agent", "unstarted"),
    labels: [reviewerLabel("daedalus")]
  })
  const claimable = linearIssue({
    id: "claimable",
    identifier: "RYA-4",
    state: workflowState("review", "In Review", "started"),
    labels: [reviewerLabel("daedalus")]
  })
  const comments = []
  const updates = []
  const logs = []
  const originalFetch = globalThis.fetch
  const originalLog = console.log

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.query.includes("query ReviewFilteredIssues")) {
      if (body.variables.statusName === "Agent Reviewing") {
        return jsonResponse({ data: { issues: { nodes: [] } } })
      }

      assert.deepEqual(body.variables, {
        first: 50,
        teamKey: "RYA",
        statusName: "In Review",
        labelNames: ["reviewer:daedalus", "daedalus", "reviewer:any", "any"]
      })
      return jsonResponse({ data: { issues: { nodes: [blocked, claimable] } } })
    }
    if (body.query.includes("query WorkflowStates")) {
      return jsonResponse({
        data: {
          workflowStates: {
            nodes: [workflowState("reviewing", "Agent Reviewing", "started", claimable.team)]
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
              identifier: "RYA-4",
              state: workflowState("reviewing", "Agent Reviewing", "started")
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
      if (body.variables.id === "blocked") {
        return jsonResponse({ data: { issue: blocked } })
      }

      return jsonResponse({
        data: {
          issue: {
            ...claimable,
            state: workflowState("reviewing", "Agent Reviewing", "started")
          }
        }
      })
    }
    throw new Error(`Unexpected query: ${body.query}`)
  }
  console.log = (message) => logs.push(String(message))

  try {
    const result = await claimNextReview(baseConfig({ stateDir }))

    assert.equal(result.identifier, "RYA-4")
    assert.deepEqual(updates.map((update) => update.id), ["claimable"])
    assert.equal(comments.length, 1)
    assert.equal(comments[0].issueId, "claimable")
    assert.match(comments[0].body, /Review claimed by daedalus at /)
    assert.match(logs.join("\n"), /Skipping RYA-1; blocked by unresolved dependencies: RYA-0/)
    assert.match(logs.join("\n"), /Selected review RYA-4/)
  } finally {
    globalThis.fetch = originalFetch
    console.log = originalLog
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("organic review polling uses server-side filters before fetching full issue details", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-review-filter-"))
  const olderEligible = linearIssue({
    id: "older-eligible",
    identifier: "RYA-99",
    state: workflowState("review", "In Review", "started"),
    labels: [reviewerLabel("daedalus")],
    createdAt: "2026-06-01T09:00:00.000Z"
  })
  const calls = []
  const originalFetch = globalThis.fetch
  const originalLog = console.log
  console.log = () => {}

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.query.includes("query ReviewFilteredIssues")) {
      calls.push(["ReviewFilteredIssues", body.variables])
      return jsonResponse({
        data: {
          issues: {
            nodes: body.variables.statusName === "In Review" ? [olderEligible] : []
          }
        }
      })
    }
    if (body.query.includes("query GetIssue")) {
      calls.push(["GetIssue", body.variables])
      return jsonResponse({ data: { issue: olderEligible } })
    }
    throw new Error(`Unexpected query: ${body.query}`)
  }

  try {
    const result = await claimNextReview(baseConfig({ stateDir, dryRun: true }))

    assert.equal(result, null)
    assert.deepEqual(calls.map(([name]) => name), ["ReviewFilteredIssues", "ReviewFilteredIssues", "GetIssue"])
    assert.deepEqual(calls[0][1], {
      first: 50,
      teamKey: "RYA",
      statusName: "Agent Reviewing",
      labelNames: ["reviewer:daedalus", "daedalus", "reviewer:any", "any"]
    })
    assert.deepEqual(calls[1][1], {
      first: 50,
      teamKey: "RYA",
      statusName: "In Review",
      labelNames: ["reviewer:daedalus", "daedalus", "reviewer:any", "any"]
    })
    assert.deepEqual(calls[2][1], { id: "older-eligible" })
  } finally {
    globalThis.fetch = originalFetch
    console.log = originalLog
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("organic review polling still filters by status and reviewer labels without a team key", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-review-all-teams-"))
  const issue = linearIssue({
    id: "all-teams-eligible",
    identifier: "RYA-100",
    state: workflowState("review", "In Review", "started"),
    labels: [reviewerLabel("daedalus")]
  })
  const calls = []
  const originalFetch = globalThis.fetch
  const originalLog = console.log
  console.log = () => {}

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.query.includes("query ReviewFilteredIssuesAllTeams")) {
      calls.push(["ReviewFilteredIssuesAllTeams", body.variables])
      return jsonResponse({
        data: {
          issues: {
            nodes: body.variables.statusName === "In Review" ? [issue] : []
          }
        }
      })
    }
    if (body.query.includes("query GetIssue")) {
      calls.push(["GetIssue", body.variables])
      return jsonResponse({ data: { issue } })
    }
    throw new Error(`Unexpected query: ${body.query}`)
  }

  try {
    await claimNextReview(baseConfig({ stateDir, teamKey: undefined, dryRun: true }))

    assert.deepEqual(calls.map(([name]) => name), ["ReviewFilteredIssuesAllTeams", "ReviewFilteredIssuesAllTeams", "GetIssue"])
    assert.deepEqual(calls[1][1], {
      first: 50,
      statusName: "In Review",
      labelNames: ["reviewer:daedalus", "daedalus", "reviewer:any", "any"]
    })
  } finally {
    globalThis.fetch = originalFetch
    console.log = originalLog
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("advise mode can select an explicit issue without claiming", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "codex-linear-review-advise-"))
  const issue = linearIssue({
    state: workflowState("running", "Agent In Progress", "started"),
    labels: []
  })
  const calls = []
  const originalLog = console.log
  console.log = () => {}

  try {
    const result = await claimNextReview(baseConfig({
      stateDir,
      advise: true,
      reviewIssueId: "RYA-105"
    }), {
      getIssue: async (issueId) => {
        calls.push(["getIssue", issueId])
        return issue
      },
      getReviewCandidateIssues: async () => {
        calls.push(["getReviewCandidateIssues"])
        return []
      },
      getReviewRunningIssues: async () => {
        calls.push(["getReviewRunningIssues"])
        return []
      },
      claimReviewIssue: async () => {
        calls.push(["claimReviewIssue"])
        throw new Error("advise mode should not claim")
      },
      createComment: async () => {
        calls.push(["createComment"])
        throw new Error("advise mode should not comment")
      }
    })

    assert.equal(result, issue)
    assert.deepEqual(calls, [["getIssue", "RYA-105"]])
  } finally {
    console.log = originalLog
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test("review prompt includes advise guardrails and state routing", () => {
  const prompt = buildReviewPrompt(baseConfig({
    advise: true,
    reviewArtifactUrl: "https://github.com/example/repo/pull/123"
  }), linearIssue({
    state: workflowState("review", "In Review", "started"),
    labels: [reviewerLabel("daedalus")]
  }))

  assert.match(prompt, /Review mode: advise only/)
  assert.match(prompt, /Do not create or update Linear comments, GitHub comments.*or merge PRs/)
  assert.match(prompt, /Additional artifact URL: https:\/\/github\.com\/example\/repo\/pull\/123/)
  assert.match(prompt, /Required changes:.*move the issue to "Waiting For Agent"/s)
  assert.match(prompt, /passing GitHub PRs in apply mode.*merge the PR before leaving the Linear success comment/s)
  assert.match(prompt, /Successful GitHub PR comments must state that the PR was merged/)
  assert.match(prompt, /Passed:.*merged PR URL.*move the issue to "Review Passed"/s)
  assert.match(prompt, /GitHub PR otherwise passes but cannot be merged.*do not use the Passed verdict/s)
  assert.match(prompt, /Reviewer Independence:/)
})

const baseConfig = (overrides = {}) => ({
  linearApiKey: "test-key",
  linearApiUrl: "https://linear.example/graphql",
  agentId: "daedalus",
  teamKey: "RYA",
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
  stateDir: join(tmpdir(), "codex-linear-test-unused-review-state"),
  waitTimeoutMs: 60_000,
  lockStaleMs: 600_000,
  fetchLimit: 50,
  dryRun: false,
  noSpawn: false,
  advise: false,
  ...overrides
})

const linearIssue = ({
  id = "issue-1",
  identifier = "RYA-1",
  labels = [],
  comments = [],
  state = workflowState("state-1", "Agent In Progress", "started"),
  relations = [],
  inverseRelations = [],
  createdAt = "2026-06-29T09:00:00.000Z"
} = {}) => ({
  id,
  identifier,
  title: "Test issue",
  url: `https://linear.app/example/${identifier}`,
  priority: 2,
  createdAt,
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

const reviewerLabel = (name) => ({
  id: `reviewer-${name}`,
  name,
  parent: { id: "reviewer", name: "reviewer" }
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
  relatedIssue: dependencyIssue(targetIdentifier, workflowState("review", "In Review", "started"))
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
