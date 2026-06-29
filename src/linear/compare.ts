import type { LinearIssue } from "./types.js"

export const compareIssues = (left: LinearIssue, right: LinearIssue): number =>
  byPriority(left, right) || byCreatedAt(left, right)

const byPriority = (left: LinearIssue, right: LinearIssue): number =>
  normalizedPriority(left) - normalizedPriority(right)

const byCreatedAt = (left: LinearIssue, right: LinearIssue): number =>
  Date.parse(left.createdAt) - Date.parse(right.createdAt)

const normalizedPriority = (issue: LinearIssue): number =>
  issue.priority === 0 ? Number.MAX_SAFE_INTEGER : issue.priority
