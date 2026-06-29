import { formatLabel } from "../linear/labels.js"
import type { LinearIssue } from "../linear/types.js"

interface Person {
  id: string
  name: string
  email?: string | null
}

export const buildIssueSnapshot = (issue: LinearIssue): Record<string, unknown> => ({
  identifier: issue.identifier,
  title: issue.title,
  url: issue.url,
  description: issue.description ?? "",
  priority: {
    value: issue.priority,
    label: issue.priorityLabel ?? null
  },
  status: {
    name: issue.state.name,
    type: issue.state.type ?? null
  },
  team: issue.team,
  labels: issue.labels.nodes.map(formatLabel),
  assignee: issue.assignee ? personSnapshot(issue.assignee) : null,
  creator: issue.creator ? personSnapshot(issue.creator) : null,
  project: issue.project ? { id: issue.project.id, name: issue.project.name } : null,
  cycle: issue.cycle ? { id: issue.cycle.id, name: issue.cycle.name } : null,
  createdAt: issue.createdAt,
  updatedAt: issue.updatedAt,
  recentComments: issue.comments?.nodes.map((comment) => ({
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    user: comment.user ? personSnapshot(comment.user) : null
  })) ?? []
})

const personSnapshot = (person: Person): Record<string, string | null> => ({
  id: person.id,
  name: person.name,
  email: person.email ?? null
})
