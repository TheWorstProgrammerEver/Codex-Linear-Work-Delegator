import { acquireLock } from "../lock.js"
import { getCurrentState } from "../state.js"
import { getUnresolvedBlockers } from "../linear/dependencies.js"
import { matchesLabel } from "../linear/labels.js"
import { LinearClient } from "../linear.js"
import { checkAbandonedReview } from "./abandoned-review.js"
import type { Config } from "../env/types.js"
import type { LinearIssue } from "../linear/types.js"

export interface ReviewLinearClient {
  getIssue(issueId: string): Promise<LinearIssue>
  getReviewCandidateIssues(): Promise<LinearIssue[]>
  getReviewRunningIssues(): Promise<LinearIssue[]>
  claimReviewIssue(issue: LinearIssue): Promise<LinearIssue>
  createComment(issueId: string, body: string): Promise<void>
}

export async function claimNextReview(
  config: Config,
  linear: ReviewLinearClient = new LinearClient(config)
): Promise<LinearIssue | null> {
  const lock = acquireLock(config)

  if (!lock) {
    console.log("Another review cycle is already running; exiting.")
    return null
  }

  try {
    return await claimNextReviewWithLock(config, linear)
  } finally {
    lock.release()
  }
}

async function claimNextReviewWithLock(config: Config, linear: ReviewLinearClient): Promise<LinearIssue | null> {
  const busy = getCurrentState(config)
  if (busy) {
    console.log(`Reviewer is busy with ${busy.identifier} pid=${busy.pid}; exiting.`)
    return null
  }

  if (await checkAbandonedReview(config, linear)) return null

  const nextIssue = await selectReviewIssue(config, linear)
  if (!nextIssue) {
    console.log("No eligible Linear issues found for review.")
    return null
  }

  console.log(`Selected review ${nextIssue.identifier}: ${nextIssue.title}`)
  if (config.dryRun) {
    console.log("Dry run enabled; not claiming or spawning.")
    return null
  }

  if (config.advise) {
    console.log("Advise mode enabled; not claiming or changing Linear state.")
    return nextIssue
  }

  const claimedIssue = await linear.claimReviewIssue(nextIssue)
  console.log(`Claimed review ${claimedIssue.identifier}; state=${claimedIssue.state.name}`)
  return claimedIssue
}

async function selectReviewIssue(config: Config, linear: ReviewLinearClient): Promise<LinearIssue | null> {
  if (config.reviewIssueId) {
    const issue = await linear.getIssue(config.reviewIssueId)
    return validateExplicitReviewIssue(config, issue) ? issue : null
  }

  const candidates = await getDetailedReviewCandidates(linear)
  return candidates.find((issue) => {
    const blockers = getUnresolvedBlockers(issue)
    if (blockers.length === 0) return true

    console.log(
      `Skipping ${issue.identifier}; blocked by unresolved dependencies: ${blockers.map((blocker) => blocker.identifier).join(", ")}.`
    )
    return false
  }) ?? null
}

async function getDetailedReviewCandidates(linear: ReviewLinearClient): Promise<LinearIssue[]> {
  const candidates = await linear.getReviewCandidateIssues()
  return Promise.all(candidates.map((issue) => linear.getIssue(issue.id)))
}

function validateExplicitReviewIssue(config: Config, issue: LinearIssue): boolean {
  if (config.teamKey && issue.team.key !== config.teamKey) {
    console.log(`Skipping ${issue.identifier}; team ${issue.team.key} does not match configured team ${config.teamKey}.`)
    return false
  }

  if (!config.advise && issue.state.name !== config.reviewReadyStatus) {
    console.log(`Skipping ${issue.identifier}; status is "${issue.state.name}", expected "${config.reviewReadyStatus}".`)
    return false
  }

  if (!config.advise && !hasReviewerLabel(config, issue)) {
    console.log(`Skipping ${issue.identifier}; missing one of reviewer labels: ${config.reviewerLabels.join(", ")}.`)
    return false
  }

  const blockers = getUnresolvedBlockers(issue)
  if (!config.advise && blockers.length > 0) {
    console.log(
      `Skipping ${issue.identifier}; blocked by unresolved dependencies: ${blockers.map((blocker) => blocker.identifier).join(", ")}.`
    )
    return false
  }

  return true
}

const hasReviewerLabel = (config: Config, issue: LinearIssue): boolean =>
  config.reviewerLabels.some((reviewerLabel) => issue.labels.nodes.some((label) => matchesLabel(label, reviewerLabel)))
