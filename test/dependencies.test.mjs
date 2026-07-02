import assert from "node:assert/strict"
import test from "node:test"

import { getIssueDependencies, getUnresolvedBlockers } from "../dist/linear/dependencies.js"

test("unresolved blockedBy dependencies are claim blockers", () => {
  const issue = linearIssue({
    inverseRelations: [blocksRelation(blockerIssue({ identifier: "RYA-1", state: state("Agent In Progress", "started") }), "RYA-2")]
  })

  assert.deepEqual(
    getUnresolvedBlockers(issue).map((dependency) => ({
      direction: dependency.direction,
      identifier: dependency.identifier,
      status: dependency.status
    })),
    [
      {
        direction: "blockedBy",
        identifier: "RYA-1",
        status: { name: "Agent In Progress", type: "started" }
      }
    ]
  )
})

test("completed and canceled blockedBy dependencies do not block claim", () => {
  const issue = linearIssue({
    inverseRelations: [
      blocksRelation(blockerIssue({ identifier: "RYA-1", state: state("Done", "completed") }), "RYA-3"),
      blocksRelation(blockerIssue({ identifier: "RYA-2", state: state("Canceled", "canceled") }), "RYA-3")
    ]
  })

  assert.deepEqual(getUnresolvedBlockers(issue), [])
})

test("downstream blocks dependencies are context but not claim blockers", () => {
  const issue = linearIssue({
    relations: [blocksRelation(blockerIssue({ identifier: "RYA-4" }), "RYA-5")]
  })

  assert.deepEqual(getUnresolvedBlockers(issue), [])
  assert.deepEqual(
    getIssueDependencies(issue).map((dependency) => dependency.direction),
    ["blocks"]
  )
})

const linearIssue = ({ relations = [], inverseRelations = [] } = {}) => ({
  id: "issue-1",
  identifier: "RYA-3",
  title: "Blocked candidate",
  url: "https://linear.app/example/RYA-3",
  priority: 2,
  createdAt: "2026-06-29T09:00:00.000Z",
  updatedAt: "2026-06-29T09:00:00.000Z",
  state: state("Waiting For Agent", "unstarted"),
  labels: { nodes: [] },
  relations: { nodes: relations },
  inverseRelations: { nodes: inverseRelations },
  team: { id: "team-1", key: "RYA", name: "Ryan Hayward" }
})

const blocksRelation = (sourceIssue, targetIdentifier) => ({
  id: `relation-${sourceIssue.identifier}-${targetIdentifier}`,
  type: "blocks",
  issue: sourceIssue,
  relatedIssue: blockerIssue({ identifier: targetIdentifier })
})

const blockerIssue = ({
  identifier,
  state: issueState = state("Agent In Progress", "started")
}) => ({
  identifier,
  title: `Issue ${identifier}`,
  url: `https://linear.app/example/${identifier}`,
  state: issueState
})

const state = (name, type) => ({ id: `state-${type}`, name, type })
