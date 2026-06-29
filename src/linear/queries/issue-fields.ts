import { renderTemplateFile } from "../../template.js"

export const issueFields = renderTemplateFile(new URL("./issue-fields.graphql", import.meta.url))
