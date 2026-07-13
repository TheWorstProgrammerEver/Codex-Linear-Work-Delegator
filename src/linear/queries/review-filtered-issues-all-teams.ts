import { renderTemplateFile } from "../../template.js"
import type { LinearIssue } from "../types.js"

export const reviewFilteredIssuesAllTeamsQuery = renderTemplateFile(new URL("./review-filtered-issues-all-teams.graphql", import.meta.url))

export interface ReviewFilteredIssuesAllTeamsResponse {
  issues: { nodes: LinearIssue[] }
}
