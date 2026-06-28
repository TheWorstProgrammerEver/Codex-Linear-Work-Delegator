import type { Config, LinearIssue, WorkflowState } from "./types.js";

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

export class LinearClient {
  constructor(private readonly config: Config) {}

  async getCandidateIssues(): Promise<LinearIssue[]> {
    const issues = this.config.teamKey
      ? await this.getTeamIssues(this.config.teamKey)
      : await this.getAllVisibleIssues();

    const candidates = issues.filter((issue) => {
      if (this.config.teamKey && issue.team.key !== this.config.teamKey) return false;
      if (issue.state.name !== this.config.readyStatus) return false;
      return this.config.agentLabels.some((agentLabel) => issue.labels.nodes.some((label) => matchesLabel(label, agentLabel)));
    });

    return candidates.sort(compareIssues);
  }

  private async getAllVisibleIssues(): Promise<LinearIssue[]> {
    const data = await this.graphql<CandidateIssuesResponse>(CANDIDATE_ISSUES_QUERY, {
      first: this.config.fetchLimit
    });
    return data.issues.nodes;
  }

  private async getTeamIssues(teamKey: string): Promise<LinearIssue[]> {
    const teamId = await this.getTeamIdByKey(teamKey);
    const data = await this.graphql<TeamIssuesResponse>(TEAM_ISSUES_QUERY, {
      id: teamId,
      first: this.config.fetchLimit
    });
    return data.team.issues.nodes;
  }

  private async getTeamIdByKey(teamKey: string): Promise<string> {
    const data = await this.graphql<TeamsResponse>(TEAMS_QUERY, { first: 100 });
    const team = data.teams.nodes.find((candidate) => candidate.key === teamKey);
    if (!team) throw new Error(`Could not find Linear team with key ${teamKey}`);
    return team.id;
  }

  async getWorkflowStateId(teamKey: string, statusName: string): Promise<string> {
    const data = await this.graphql<WorkflowStatesResponse>(WORKFLOW_STATES_QUERY, {
      first: 100
    });
    const match = data.workflowStates.nodes.find((state) => {
      return state.team?.key === teamKey && state.name === statusName;
    });
    if (!match) throw new Error(`Could not find Linear workflow state "${statusName}" for team ${teamKey}`);
    return match.id;
  }

  async claimIssue(issue: LinearIssue): Promise<LinearIssue> {
    const runningStateId = await this.getWorkflowStateId(issue.team.key, this.config.runningStatus);
    await this.updateIssueState(issue.id, runningStateId);
    await this.createComment(issue.id, `Claimed by ${this.config.agentId} at ${new Date().toISOString()}.`);
    const claimed = await this.getIssue(issue.id);
    if (claimed.state.name !== this.config.runningStatus) {
      throw new Error(`Claim verification failed for ${issue.identifier}: state is "${claimed.state.name}"`);
    }
    return claimed;
  }

  async getIssue(issueId: string): Promise<LinearIssue> {
    const data = await this.graphql<GetIssueResponse>(GET_ISSUE_QUERY, { id: issueId });
    return data.issue;
  }

  private async updateIssueState(issueId: string, stateId: string): Promise<void> {
    const data = await this.graphql<IssueUpdateResponse>(ISSUE_UPDATE_MUTATION, {
      id: issueId,
      input: { stateId }
    });
    if (!data.issueUpdate.success) throw new Error(`Linear issueUpdate returned success=false for ${issueId}`);
  }

  private async createComment(issueId: string, body: string): Promise<void> {
    const data = await this.graphql<CommentCreateResponse>(COMMENT_CREATE_MUTATION, {
      input: { issueId, body }
    });
    if (!data.commentCreate.success) throw new Error(`Linear commentCreate returned success=false for ${issueId}`);
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.config.linearApiUrl, {
      method: "POST",
      headers: {
        "Authorization": this.config.linearApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Linear API HTTP ${response.status}: ${body}`);
    }

    const payload = await response.json() as GraphQLResponse<T>;
    if (payload.errors?.length) {
      throw new Error(`Linear API error: ${payload.errors.map((error) => error.message).join("; ")}`);
    }
    if (!payload.data) throw new Error("Linear API response did not include data");
    return payload.data;
  }
}

function compareIssues(left: LinearIssue, right: LinearIssue): number {
  const leftPriority = left.priority === 0 ? Number.MAX_SAFE_INTEGER : left.priority;
  const rightPriority = right.priority === 0 ? Number.MAX_SAFE_INTEGER : right.priority;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  url
  description
  priority
  priorityLabel
  createdAt
  updatedAt
  state { id name type }
  labels { nodes { id name parent { id name } } }
  team { id key name }
  assignee { id name email }
  creator { id name email }
  project { id name }
  cycle { id name }
`;

const ISSUE_SNAPSHOT_FIELDS = `
  ${ISSUE_FIELDS}
  comments(first: 20) {
    nodes {
      id
      body
      createdAt
      updatedAt
      user { id name email }
    }
  }
`;

const CANDIDATE_ISSUES_QUERY = `
  query CandidateIssues($first: Int!) {
    issues(first: $first) {
      nodes {
        ${ISSUE_FIELDS}
      }
    }
  }
`;

const TEAMS_QUERY = `
  query Teams($first: Int!) {
    teams(first: $first) {
      nodes { id key name }
    }
  }
`;

const TEAM_ISSUES_QUERY = `
  query TeamIssues($id: String!, $first: Int!) {
    team(id: $id) {
      issues(first: $first) {
        nodes {
          ${ISSUE_FIELDS}
        }
      }
    }
  }
`;

const WORKFLOW_STATES_QUERY = `
  query WorkflowStates($first: Int!) {
    workflowStates(first: $first) {
      nodes {
        id
        name
        type
        team { id key name }
      }
    }
  }
`;

const GET_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      ${ISSUE_SNAPSHOT_FIELDS}
    }
  }
`;

const ISSUE_UPDATE_MUTATION = `
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue { id identifier state { id name type } }
    }
  }
`;

const COMMENT_CREATE_MUTATION = `
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment { id }
    }
  }
`;

interface CandidateIssuesResponse {
  issues: { nodes: LinearIssue[] };
}

interface TeamsResponse {
  teams: { nodes: Array<{ id: string; key: string; name: string }> };
}

interface TeamIssuesResponse {
  team: { issues: { nodes: LinearIssue[] } };
}

interface WorkflowStatesResponse {
  workflowStates: { nodes: WorkflowState[] };
}

interface GetIssueResponse {
  issue: LinearIssue;
}

interface IssueUpdateResponse {
  issueUpdate: { success: boolean };
}

interface CommentCreateResponse {
  commentCreate: { success: boolean };
}

function matchesLabel(label: { name: string; parent?: { name: string } | null }, expected: string): boolean {
  if (label.name === expected) return true;
  if (!label.parent?.name) return false;
  return `${label.parent.name}:${label.name}` === expected;
}
