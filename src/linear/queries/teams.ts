import { renderTemplateFile } from "../../template.js";
import type { LinearTeam } from "../types.js";

export const teamsQuery = renderTemplateFile(new URL("./teams.graphql", import.meta.url));

export interface TeamsResponse {
  teams: { nodes: LinearTeam[] };
}
