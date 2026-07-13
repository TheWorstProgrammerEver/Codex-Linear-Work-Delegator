import { renderTemplateFile } from "../template.js"
import { buildIssueSnapshot } from "../codex/snapshot.js"
import type { Config } from "../env/types.js"
import type { LinearIssue } from "../linear/types.js"

export const buildReviewPrompt = (config: Config, issue: LinearIssue): string =>
  renderTemplateFile(new URL("./prompt.md", import.meta.url), {
    agentId: config.agentId,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    issueSnapshotJson: JSON.stringify(buildIssueSnapshot(issue), null, 2),
    modeInstructions: buildModeInstructions(config),
    artifactInstructions: buildArtifactInstructions(config),
    reviewReadyStatus: config.reviewReadyStatus,
    reviewRunningStatus: config.reviewRunningStatus,
    reviewPassedStatus: config.reviewPassedStatus,
    reviewReturnStatus: config.reviewReturnStatus,
    blockedStatus: config.blockedStatus
  })

function buildModeInstructions(config: Config): string {
  if (!config.advise) {
    return [
      "Review mode: apply.",
      "You may leave review comments on the appropriate external artifact and update Linear according to the state routing rules below."
    ].join("\n")
  }

  return [
    "Review mode: advise only.",
    "Do not create or update Linear comments, GitHub comments, GitHub reviews, issue statuses, branches, commits, files, or merge PRs.",
    "Inspect the issue and artifact, run narrow read-only validation where practical, and write the review result to this Codex run output only."
  ].join("\n")
}

function buildArtifactInstructions(config: Config): string {
  if (!config.reviewArtifactUrl) return "Additional artifact URL: none provided. Discover the expected artifact from the Linear issue, comments, links, branch names, and completion notes."
  return `Additional artifact URL: ${config.reviewArtifactUrl}`
}
