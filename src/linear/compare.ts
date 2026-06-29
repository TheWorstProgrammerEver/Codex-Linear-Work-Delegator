import type { LinearIssue } from "./types.js";

export function compareIssues(left: LinearIssue, right: LinearIssue): number {
  return byPriority(left, right) || byCreatedAt(left, right);
}

function byPriority(left: LinearIssue, right: LinearIssue): number {
  return normalizedPriority(left) - normalizedPriority(right);
}

function byCreatedAt(left: LinearIssue, right: LinearIssue): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

function normalizedPriority(issue: LinearIssue): number {
  return issue.priority === 0 ? Number.MAX_SAFE_INTEGER : issue.priority;
}
