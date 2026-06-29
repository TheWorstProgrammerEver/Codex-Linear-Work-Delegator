import { renderTemplateFile } from "../template.js";
import { buildIssueSnapshot } from "./snapshot.js";
import type { Config } from "../env/types.js";
import type { LinearIssue } from "../linear/types.js";

export function buildPrompt(config: Config, issue: LinearIssue): string {
  return renderTemplateFile(new URL("./prompt.md", import.meta.url), {
    agentId: config.agentId,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    issueSnapshotJson: JSON.stringify(buildIssueSnapshot(issue), null, 2),
    reviewStatus: config.reviewStatus,
    blockedStatus: config.blockedStatus
  });
}
