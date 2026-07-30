import { getCurrentState } from "../state.js"
import { matchesLabel } from "../linear/labels.js"
import { renderTemplateFile } from "../template.js"
import { readReviewRunRecord } from "./run-record.js"
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
  const abandoned = getAbandonedReviews(config, current, issues)

  for (const issue of abandoned) {
    const record = readReviewRunRecord(config, issue.id)
    const recoverySummary = formatRecoverySummary(record, issue)
    if (hasExistingHealthWarning(issue)) {
      console.log(`Recovery still required for ${issue.identifier} (${recoverySummary}); prior health warning already exists.`)
      continue
    }

    if (config.dryRun) {
      console.log(`Dry run: would add abandoned-review warning to ${issue.identifier}.`)
      continue
    }

    await linear.createComment(issue.id, buildAbandonedReviewComment(config, issue, recoverySummary))
    console.log(`Added abandoned-review warning to ${issue.identifier}.`)
  }

  if (abandoned.length > 0) {
    console.log("Found likely abandoned in-progress review for this agent; exiting without claiming a new review.")
  }

  return abandoned.length
}

export function getAbandonedReviews(
  config: Config,
  current: CurrentState | null,
  issues: LinearIssue[]
): LinearIssue[] {
  return issues.filter((issue) => isOwnedAbandonedReview(config, current, issue))
}

function isOwnedAbandonedReview(config: Config, current: CurrentState | null, issue: LinearIssue): boolean {
  if (current && (current.issueId === issue.id || current.identifier === issue.identifier)) return false

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

function buildAbandonedReviewComment(config: Config, issue: LinearIssue, recoverySummary: string): string {
  return renderTemplateFile(new URL("./abandoned-review-comment.md", import.meta.url), {
    healthWarningMarker: REVIEW_HEALTH_WARNING_MARKER,
    identifier: issue.identifier,
    runningStatus: config.reviewRunningStatus,
    blockedStatus: config.blockedStatus,
    reviewReadyStatus: config.reviewReadyStatus,
    reviewReturnStatus: config.reviewReturnStatus,
    recoverySummary,
    agentId: config.agentId,
    signoff: `\u2014 ${config.agentId}`
  })
}

function formatRecoverySummary(record: ReturnType<typeof readReviewRunRecord>, issue: LinearIssue): string {
  if (!record) return "no bounded local exit record"

  const latestClaim = getLatestReviewClaim(issue.comments?.nodes ?? [])
  if (latestClaim && Date.parse(record.startedAt) < Date.parse(latestClaim.claimedAt)) {
    return "no bounded local exit record for the latest review claim"
  }

  const exit = record.exitCode === null ? "exit code unavailable" : `exit code ${record.exitCode}`
  const signal = record.signal ? `, signal ${record.signal}` : ""
  return `${record.classification}, ${exit}${signal}, ${record.logEvidence.byteCount} log bytes, recorded ${record.recordedAt}`
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
  return getLatestReviewClaim(comments)?.agentId ?? null
}

function getLatestReviewClaim(comments: LinearComment[]): { agentId: string, claimedAt: string } | null {
  const claim = [...comments]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map((comment) => parseReviewClaim(comment.body))
    .find((parsed) => parsed !== null)

  return claim ?? null
}

function parseReviewClaim(body: string): { agentId: string, claimedAt: string } | null {
  const match = body.match(/^Review claimed by\s+(.+?)\s+at\s+(\d{4}-\d{2}-\d{2}T\S+?)\.?$/)
  if (!match?.[1] || !match[2]) return null
  return { agentId: match[1].trim(), claimedAt: match[2] }
}
