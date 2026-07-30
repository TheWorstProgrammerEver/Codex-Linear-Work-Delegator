import type { Config } from "../env/types.js"
import type { LinearIssue } from "../linear/types.js"
import type { CodexReadinessResult } from "./readiness.js"

export interface ReadinessCommentClient {
  getIssue(issueId: string): Promise<LinearIssue>
  createComment(issueId: string, body: string): Promise<void>
}

type FailedReadinessResult = Exclude<CodexReadinessResult, { ready: true }>
type ReadinessPurpose = "work" | "review"

export async function reportReadinessFailure(
  config: Config,
  linear: ReadinessCommentClient,
  issue: LinearIssue,
  result: FailedReadinessResult,
  purpose: ReadinessPurpose
): Promise<void> {
  const detailedIssue = issue.comments ? issue : await linear.getIssue(issue.id)
  const marker = commentMarker(result.code, purpose)
  const signature = `— ${config.agentId}.`
  const alreadyReported = detailedIssue.comments?.nodes.some((comment) =>
    comment.body.includes(marker) && comment.body.trimEnd().endsWith(signature)
  )

  if (alreadyReported) return
  await linear.createComment(issue.id, buildComment(config, result, purpose, marker))
}

function buildComment(
  config: Config,
  result: FailedReadinessResult,
  purpose: ReadinessPurpose,
  marker: string
): string {
  const action = purpose === "work" ? "claim issue work" : "claim this review"
  const readyStatus = purpose === "work" ? config.readyStatus : config.reviewReadyStatus

  if (result.code === "authentication-failed") {
    return [
      marker,
      "",
      "Linear API access succeeded far enough to select this issue, but the isolated non-interactive `codex exec` probe reported an authentication failure.",
      "",
      `I did not ${action} or start the issue workload. The issue remains in \`${readyStatus}\` and can be retried automatically after Codex execution authentication is restored.`,
      "",
      "No credential values, environment-file contents, or raw subprocess output were added to this comment or the worker log.",
      "",
      `— ${config.agentId}.`
    ].join("\n")
  }

  return [
    marker,
    "",
    "Linear API access succeeded far enough to select this issue, but the isolated non-interactive `codex exec` probe did not produce deterministic readiness evidence.",
    "",
    `I did not ${action} or change its Linear status. The issue remains in \`${readyStatus}\`. This result is ambiguous, so it must not be treated as proof that a runtime performed no activity based on exit timing or exit code.`,
    "",
    `Probe result code: \`${result.code}\`. Inspect the worker service and Codex installation/authentication state before retrying.`,
    "",
    "No credential values, environment-file contents, or raw subprocess output were added to this comment or the worker log.",
    "",
    `— ${config.agentId}.`
  ].join("\n")
}

const commentMarker = (
  code: FailedReadinessResult["code"],
  purpose: ReadinessPurpose
): string =>
  `Codex execution readiness check (${purpose}, ${code}):`
