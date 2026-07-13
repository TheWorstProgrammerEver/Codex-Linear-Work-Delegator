import { getCurrentState } from "../state.js"
import { matchesLabel } from "../linear/labels.js"
import { renderTemplateFile } from "../template.js"
import type { Config } from "../env/types.js"
import type { LinearComment, LinearIssue } from "../linear/types.js"
import type { CurrentState } from "../state.js"

const REVIEW_HEALTH_WARNING_MARKER = "Review startup health check:"

export interface ReviewHealthCheckLinearClient {
  getIssue(issueId: string): Promise<LinearIssue>
  getReviewRunningIssues(): Promise<LinearIssue[]>
  createComment(issueId: string, body: string): Promise<void>
}

export async function checkAbandonedReview(
  config: Config,
  linear: ReviewHealthCheckLinearClient
): Promise<number> {
  if (config.advise) return 0

  const current = getCurrentState(config)
  const issues = await getDetailedHealthCheckIssues(config, linear)
  const abandoned = getAbandonedReviewWarnings(config, current, issues)

  for (const issue of abandoned) {
    if (config.dryRun) {
      console.log(`Dry run: would add abandoned-review warning to ${issue.identifier}.`)
      continue
    }

    await linear.createComment(issue.id, buildAbandonedReviewComment(config, issue))
    console.log(`Added abandoned-review warning to ${issue.identifier}.`)
  }

  if (abandoned.length > 0) {
    console.log("Found likely abandoned in-progress review for this agent; exiting without claiming a new review.")
  }

  return abandoned.length
}

export function getAbandonedReviewWarnings(
  config: Config,
  current: CurrentState | null,
  issues: LinearIssue[]
): LinearIssue[] {
  return issues.filter((issue) => shouldWarnAboutIssue(config, current, issue))
}

function shouldWarnAboutIssue(config: Config, current: CurrentState | null, issue: LinearIssue): boolean {
  if (current && (current.issueId === issue.id || current.identifier === issue.identifier)) return false
  if (hasExistingHealthWarning(issue)) return false

  if (hasConfiguredDirectReviewerLabel(config, issue)) return true
  return hasConfiguredReviewerAnyLabel(config, issue) && latestReviewClaimAgent(issue.comments?.nodes ?? []) === config.agentId
}

async function getDetailedHealthCheckIssues(
  config: Config,
  linear: ReviewHealthCheckLinearClient
): Promise<LinearIssue[]> {
  const runningIssues = await linear.getReviewRunningIssues()
  const relevantIssues = runningIssues.filter((issue) =>
    hasConfiguredReviewerLabel(config, issue)
  )

  return Promise.all(relevantIssues.map((issue) => linear.getIssue(issue.id)))
}

function buildAbandonedReviewComment(config: Config, issue: LinearIssue): string {
  return renderTemplateFile(new URL("./abandoned-review-comment.md", import.meta.url), {
    healthWarningMarker: REVIEW_HEALTH_WARNING_MARKER,
    identifier: issue.identifier,
    runningStatus: config.reviewRunningStatus,
    blockedStatus: config.blockedStatus,
    reviewReadyStatus: config.reviewReadyStatus,
    agentId: config.agentId,
    signoff: `\u2014 ${config.agentId}`
  })
}

const hasConfiguredReviewerLabel = (config: Config, issue: LinearIssue): boolean =>
  config.reviewerLabels.some((reviewerLabel) => issue.labels.nodes.some((label) => matchesLabel(label, reviewerLabel)))

const hasConfiguredDirectReviewerLabel = (config: Config, issue: LinearIssue): boolean =>
  config.reviewerLabels
    .filter((reviewerLabel) => reviewerLabel !== "reviewer:any")
    .some((reviewerLabel) => issue.labels.nodes.some((label) => matchesLabel(label, reviewerLabel)))

const hasConfiguredReviewerAnyLabel = (config: Config, issue: LinearIssue): boolean =>
  config.reviewerLabels.includes("reviewer:any") && issue.labels.nodes.some((label) => matchesLabel(label, "reviewer:any"))

const hasExistingHealthWarning = (issue: LinearIssue): boolean =>
  (issue.comments?.nodes ?? []).some((comment) => comment.body.includes(REVIEW_HEALTH_WARNING_MARKER))

function latestReviewClaimAgent(comments: LinearComment[]): string | null {
  const claim = [...comments]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .find((comment) => parseReviewClaimAgent(comment.body))

  return claim ? parseReviewClaimAgent(claim.body) : null
}

function parseReviewClaimAgent(body: string): string | null {
  const match = body.match(/^Review claimed by\s+(.+?)\s+at\s+\d{4}-\d{2}-\d{2}T/)
  return match?.[1]?.trim() ?? null
}
