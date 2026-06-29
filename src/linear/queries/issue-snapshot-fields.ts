import { renderTemplateFile } from "../../template.js";
import { issueFields } from "./issue-fields.js";

export const issueSnapshotFields = renderTemplateFile(new URL("./issue-snapshot-fields.graphql", import.meta.url), {
  issueFields
});
