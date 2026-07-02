import type { LinearIssue, LinearIssueDependency } from "./types.js"

export type DependencyDirection = "blockedBy" | "blocks"

const RESOLVED_STATE_TYPES = new Set(["completed", "canceled"])

export interface IssueDependencyContext {
  direction: DependencyDirection
  identifier: string
  title: string
  url: string
  status: {
    name: string
    type: string | null
  }
}

export const getIssueDependencies = (issue: LinearIssue): IssueDependencyContext[] => [
  ...getDependenciesByDirection(issue, "blockedBy"),
  ...getDependenciesByDirection(issue, "blocks")
]

export const getUnresolvedBlockers = (issue: LinearIssue): IssueDependencyContext[] =>
  getDependenciesByDirection(issue, "blockedBy").filter((dependency) => !isResolvedDependency(dependency))

const getDependenciesByDirection = (
  issue: LinearIssue,
  direction: DependencyDirection
): IssueDependencyContext[] =>
  relationNodes(issue, direction)
    .filter((relation) => relation.type === "blocks")
    .map((relation) => relationIssue(relation, direction))
    .map((dependencyIssue) => toDependencyContext(dependencyIssue, direction))

const relationNodes = (issue: LinearIssue, direction: DependencyDirection) =>
  direction === "blockedBy"
    ? issue.inverseRelations?.nodes ?? []
    : issue.relations?.nodes ?? []

const relationIssue = (relation: LinearIssueDependency, direction: DependencyDirection) =>
  direction === "blockedBy" ? relation.issue : relation.relatedIssue

const toDependencyContext = (
  issue: LinearIssueDependency["issue"],
  direction: DependencyDirection
): IssueDependencyContext => ({
  direction,
  identifier: issue.identifier,
  title: issue.title,
  url: issue.url,
  status: {
    name: issue.state.name,
    type: issue.state.type ?? null
  }
})

const isResolvedDependency = (dependency: IssueDependencyContext) =>
  dependency.status.type ? RESOLVED_STATE_TYPES.has(dependency.status.type) : false
