import assert from "node:assert/strict"
import test from "node:test"

import { buildPrompt } from "../dist/codex/prompt.js"
import { buildIssueSnapshot } from "../dist/codex/snapshot.js"

test("issue snapshot keeps compact fallback context", () => {
  const snapshot = buildIssueSnapshot(linearIssue())

  assert.deepEqual(Object.keys(snapshot), [
    "identifier",
    "title",
    "url",
    "description",
    "priority",
    "status",
    "labels",
    "team",
    "assignee",
    "project",
    "cycle",
    "updatedAt",
    "dependencies",
    "recentComments"
  ])
  assert.deepEqual(snapshot.team, { key: "RYA", name: "Ryan Hayward" })
  assert.equal(snapshot.assignee, "Worker")
  assert.equal(snapshot.project, "Agent Runtime")
  assert.equal(snapshot.cycle, "Week 1")
  assert.deepEqual(snapshot.labels, ["agent:daedalus"])
  assert.equal(JSON.stringify(snapshot).includes("worker@example.com"), false)
  assert.equal(JSON.stringify(snapshot).includes("assignee-1"), false)
})

test("issue snapshot includes compact dependency metadata", () => {
  const snapshot = buildIssueSnapshot(linearIssue({
    inverseRelations: [blocksRelation(dependencyIssue("RYA-0", "Agent In Progress", "started"), "RYA-1")],
    relations: [blocksRelation(dependencyIssue("RYA-1", "Agent In Progress", "started"), "RYA-2")]
  }))

  assert.deepEqual(snapshot.dependencies, [
    {
      direction: "blockedBy",
      identifier: "RYA-0",
      title: "Issue RYA-0",
      url: "https://linear.app/example/RYA-0",
      status: { name: "Agent In Progress", type: "started" }
    },
    {
      direction: "blocks",
      identifier: "RYA-2",
      title: "Issue RYA-2",
      url: "https://linear.app/example/RYA-2",
      status: { name: "Agent In Progress", type: "started" }
    }
  ])
})

test("spawned prompt instructs agents to refresh and honor dependency blockers", () => {
  const prompt = buildPrompt(baseConfig(), linearIssue())

  assert.match(prompt, /dependency relations immediately/)
  assert.match(prompt, /unresolved issues blocking this one/)
  assert.match(prompt, /move this issue to "Blocked"/)
  assert.match(prompt, /do not stop merely because downstream work is waiting/)
})

test("issue snapshot truncates description and latest comments", () => {
  const snapshot = buildIssueSnapshot(linearIssue({
    description: "d".repeat(4_010),
    comments: [
      comment("old", "2026-06-29T09:00:00.000Z", "Old User"),
      comment("newest", "2026-06-29T11:00:00.000Z", "New User"),
      comment("c".repeat(1_510), "2026-06-29T10:00:00.000Z", "Verbose User")
    ]
  }))

  assert.match(snapshot.description, /\[truncated 10 characters\]$/)
  assert.deepEqual(
    snapshot.recentComments.map((comment) => comment.user),
    ["New User", "Verbose User"]
  )
  assert.equal(snapshot.recentComments[0].body, "newest")
  assert.match(snapshot.recentComments[1].body, /\[truncated 10 characters\]$/)
})

const linearIssue = ({
  description = "Do the work.",
  comments = [comment("Most recent comment.", "2026-06-29T09:00:00.000Z", "Ryan")],
  relations = [],
  inverseRelations = []
} = {}) => ({
  id: "issue-1",
  identifier: "RYA-1",
  title: "Test issue",
  url: "https://linear.app/example/RYA-1",
  description,
  priority: 2,
  priorityLabel: "High",
  createdAt: "2026-06-29T08:00:00.000Z",
  updatedAt: "2026-06-29T09:00:00.000Z",
  state: { id: "state-1", name: "Agent In Progress", type: "started" },
  labels: {
    nodes: [
      { id: "label-1", name: "daedalus", parent: { id: "agent", name: "agent" } }
    ]
  },
  relations: { nodes: relations },
  inverseRelations: { nodes: inverseRelations },
  team: { id: "team-1", key: "RYA", name: "Ryan Hayward" },
  comments: { nodes: comments },
  assignee: { id: "assignee-1", name: "Worker", email: "worker@example.com" },
  creator: { id: "creator-1", name: "Ryan", email: "ryan@example.com" },
  project: { id: "project-1", name: "Agent Runtime" },
  cycle: { id: "cycle-1", name: "Week 1" }
})

const comment = (body, createdAt, userName) => ({
  id: `comment-${createdAt}`,
  body,
  createdAt,
  updatedAt: createdAt,
  user: { id: `user-${userName}`, name: userName, email: `${userName}@example.com` }
})

const blocksRelation = (sourceIssue, targetIdentifier) => ({
  id: `relation-${sourceIssue.identifier}-${targetIdentifier}`,
  type: "blocks",
  issue: sourceIssue,
  relatedIssue: dependencyIssue(targetIdentifier, "Agent In Progress", "started")
})

const dependencyIssue = (identifier, stateName, stateType) => ({
  identifier,
  title: `Issue ${identifier}`,
  url: `https://linear.app/example/${identifier}`,
  state: { id: `state-${stateType}`, name: stateName, type: stateType }
})

const baseConfig = () => ({
  agentId: "daedalus",
  reviewStatus: "In Review",
  blockedStatus: "Blocked"
})
