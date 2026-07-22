import { renderTemplateFile } from "../../template.js"
import { issueFields } from "./issue-fields.js"
import type { LinearIssue } from "../types.js"

export const candidateIssuesQuery = renderTemplateFile(new URL("./candidate-issues.graphql", import.meta.url), {
  issueFields
})

export interface CandidateIssuesResponse {
  issues: {
    nodes: LinearIssue[]
    pageInfo: {
      hasNextPage: boolean
      endCursor: string | null
    }
  }
}
