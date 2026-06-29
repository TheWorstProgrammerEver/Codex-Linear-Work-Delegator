import { matchesLabel } from "../linear/labels.js"
import { getCurrentState } from "../state.js"
import type { Config } from "../env/types.js"
import type { LinearClient } from "../linear.js"
import type { LinearComment, LinearIssue } from "../linear/types.js"
import type { CurrentState } from "../state.js"

const HEALTH_WARNING_MARKER = "Startup health check:"

export async function checkAbandonedRunningWork(config: Config, linear: LinearClient): Promise<number> {
  const current = getCurrentState(config)
  const issues = await getDetailedHealthCheckIssues(config, linear)
  const abandoned = getAbandonedRunningWorkWarnings(config, current, issues)

  for (const issue of abandoned) {
    if (config.dryRun) {
      console.log(`Dry run: would add abandoned-work warning to ${issue.identifier}.`)
      continue
    }

    await linear.createComment(issue.id, buildAbandonedRunningWorkComment(config, issue))
    console.log(`Added abandoned-work warning to ${issue.identifier}.`)
  }

  if (abandoned.length > 0) {
    console.log("Found likely abandoned in-progress work for this agent; exiting without claiming new work.")
  }

  return abandoned.length
}

export function getAbandonedRunningWorkWarnings(
  config: Config,
  current: CurrentState | null,
  issues: LinearIssue[]
): LinearIssue[] {
  return issues.filter((issue) => shouldWarnAboutIssue(config, current, issue))
}

function shouldWarnAboutIssue(config: Config, current: CurrentState | null, issue: LinearIssue): boolean {
  if (current && (current.issueId === issue.id || current.identifier === issue.identifier)) return false
  if (hasExistingHealthWarning(issue)) return false
  if (hasAgentSpecificLabel(issue, config.agentId)) return true
  return hasAgentAnyLabel(issue) && latestClaimAgent(issue.comments?.nodes ?? []) === config.agentId
}

async function getDetailedHealthCheckIssues(config: Config, linear: LinearClient): Promise<LinearIssue[]> {
  const runningIssues = await linear.getRunningIssues()
  const relevantIssues = runningIssues.filter((issue) =>
    hasAgentSpecificLabel(issue, config.agentId) || hasAgentAnyLabel(issue)
  )

  return Promise.all(relevantIssues.map((issue) => linear.getIssue(issue.id)))
}

function buildAbandonedRunningWorkComment(config: Config, issue: LinearIssue): string {
  return [
    `${HEALTH_WARNING_MARKER} ${issue.identifier} is still in ${config.runningStatus} for agent ${config.agentId}, but this host has no active local worker state/process for it.`,
    "",
    "Please review whether the prior Codex run completed, is still externally active, or needs manual recovery. I am not changing status, killing processes, or assuming failure.",
    "",
    `\u2014 ${config.agentId}.`
  ].join("\n")
}

const hasAgentSpecificLabel = (issue: LinearIssue, agentId: string): boolean =>
  issue.labels.nodes.some((label) => matchesLabel(label, `agent:${agentId}`))

const hasAgentAnyLabel = (issue: LinearIssue): boolean =>
  issue.labels.nodes.some((label) => matchesLabel(label, "agent:any"))

const hasExistingHealthWarning = (issue: LinearIssue): boolean =>
  (issue.comments?.nodes ?? []).some((comment) => comment.body.includes(HEALTH_WARNING_MARKER))

function latestClaimAgent(comments: LinearComment[]): string | null {
  const claim = [...comments]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .find((comment) => parseClaimAgent(comment.body))

  return claim ? parseClaimAgent(claim.body) : null
}

function parseClaimAgent(body: string): string | null {
  const match = body.match(/^Claimed by\s+(.+?)\s+at\s+\d{4}-\d{2}-\d{2}T/)
  return match?.[1]?.trim() ?? null
}
