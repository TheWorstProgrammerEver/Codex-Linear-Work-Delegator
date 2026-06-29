import { renderTemplateFile } from "../../template.js";

export const commentCreateMutation = renderTemplateFile(new URL("./comment-create.graphql", import.meta.url));

export interface CommentCreateResponse {
  commentCreate: { success: boolean };
}
