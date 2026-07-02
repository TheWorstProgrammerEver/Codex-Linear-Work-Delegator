import { formatLabel } from "../linear/labels.js"
import { getIssueDependencies } from "../linear/dependencies.js"
import type { LinearIssue } from "../linear/types.js"

const MAX_DESCRIPTION_LENGTH = 4_000
const MAX_COMMENT_LENGTH = 1_500
const MAX_RECENT_COMMENTS = 2

export const buildIssueSnapshot = (issue: LinearIssue): Record<string, unknown> => ({
  identifier: issue.identifier,
  title: issue.title,
  url: issue.url,
  description: truncateText(issue.description ?? "", MAX_DESCRIPTION_LENGTH),
  priority: {
    value: issue.priority,
    label: issue.priorityLabel ?? null
  },
  status: {
    name: issue.state.name,
    type: issue.state.type ?? null
  },
  labels: issue.labels.nodes.map(formatLabel),
  team: {
    key: issue.team.key,
    name: issue.team.name
  },
  assignee: issue.assignee?.name ?? null,
  project: issue.project?.name ?? null,
  cycle: issue.cycle?.name ?? null,
  updatedAt: issue.updatedAt,
  dependencies: getIssueDependencies(issue),
  recentComments: latestComments(issue).map((comment) => ({
    body: truncateText(comment.body, MAX_COMMENT_LENGTH),
    createdAt: comment.createdAt,
    user: comment.user?.name ?? null
  }))
})

const latestComments = (issue: LinearIssue) =>
  [...(issue.comments?.nodes ?? [])]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_RECENT_COMMENTS)

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength)}\n\n[truncated ${value.length - maxLength} characters]`
}
