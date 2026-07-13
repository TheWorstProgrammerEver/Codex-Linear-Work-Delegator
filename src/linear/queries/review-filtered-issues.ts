import { renderTemplateFile } from "../../template.js"
import type { LinearIssue } from "../types.js"

export const reviewFilteredIssuesQuery = renderTemplateFile(new URL("./review-filtered-issues.graphql", import.meta.url))

export interface ReviewFilteredIssuesResponse {
  issues: { nodes: LinearIssue[] }
}
