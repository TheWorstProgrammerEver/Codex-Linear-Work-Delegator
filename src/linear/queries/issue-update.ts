import { renderTemplateFile } from "../../template.js"

export const issueUpdateMutation = renderTemplateFile(new URL("./issue-update.graphql", import.meta.url))

export interface IssueUpdateResponse {
  issueUpdate: { success: boolean }
}
