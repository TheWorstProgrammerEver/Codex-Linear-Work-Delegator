import { renderTemplateFile } from "../../template.js"
import { issueSnapshotFields } from "./issue-snapshot-fields.js"
import type { LinearIssue } from "../types.js"

export const getIssueQuery = renderTemplateFile(new URL("./get-issue.graphql", import.meta.url), {
  issueSnapshotFields
})

export interface GetIssueResponse {
  issue: LinearIssue
}
