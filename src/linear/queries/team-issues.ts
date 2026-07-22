import { renderTemplateFile } from "../../template.js"
import { issueFields } from "./issue-fields.js"
import type { LinearIssue } from "../types.js"

export const teamIssuesQuery = renderTemplateFile(new URL("./team-issues.graphql", import.meta.url), {
  issueFields
})

export interface TeamIssuesResponse {
  issues: {
    nodes: LinearIssue[]
    pageInfo: {
      hasNextPage: boolean
      endCursor: string | null
    }
  }
}
