import { renderTemplateFile } from "../../template.js";
import type { WorkflowState } from "../types.js";

export const workflowStatesQuery = renderTemplateFile(new URL("./workflow-states.graphql", import.meta.url));

export interface WorkflowStatesResponse {
  workflowStates: { nodes: WorkflowState[] };
}
