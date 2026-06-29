import { compareIssues } from "./linear/compare.js"
import { LinearGraphQLClient } from "./linear/graphql.js"
import { matchesLabel } from "./linear/labels.js"
import { candidateIssuesQuery, type CandidateIssuesResponse } from "./linear/queries/candidate-issues.js"
import { commentCreateMutation, type CommentCreateResponse } from "./linear/queries/comment-create.js"
import { getIssueQuery, type GetIssueResponse } from "./linear/queries/get-issue.js"
import { issueUpdateMutation, type IssueUpdateResponse } from "./linear/queries/issue-update.js"
import { teamIssuesQuery, type TeamIssuesResponse } from "./linear/queries/team-issues.js"
import { teamsQuery, type TeamsResponse } from "./linear/queries/teams.js"
import { workflowStatesQuery, type WorkflowStatesResponse } from "./linear/queries/workflow-states.js"
import type { Config } from "./env/types.js"
import type { LinearIssue } from "./linear/types.js"

export class LinearClient {
  private readonly api: LinearGraphQLClient

  constructor(private readonly config: Config) {
    this.api = new LinearGraphQLClient(config)
  }

  async getCandidateIssues(): Promise<LinearIssue[]> {
    const issues = await this.getVisibleIssues()

    const candidates = issues.filter((issue) => {
      if (this.config.teamKey && issue.team.key !== this.config.teamKey) return false
      if (issue.state.name !== this.config.readyStatus) return false
      return this.config.agentLabels.some((agentLabel) => issue.labels.nodes.some((label) => matchesLabel(label, agentLabel)))
    })

    return candidates.sort(compareIssues)
  }

  async getRunningIssues(): Promise<LinearIssue[]> {
    return (await this.getVisibleIssues()).filter((issue) => {
      if (this.config.teamKey && issue.team.key !== this.config.teamKey) return false
      return issue.state.name === this.config.runningStatus
    })
  }

  private async getVisibleIssues(): Promise<LinearIssue[]> {
    return this.config.teamKey
      ? this.getTeamIssues(this.config.teamKey)
      : this.getAllVisibleIssues()
  }

  private async getAllVisibleIssues(): Promise<LinearIssue[]> {
    const data = await this.api.request<CandidateIssuesResponse>(candidateIssuesQuery, {
      first: this.config.fetchLimit
    })
    return data.issues.nodes
  }

  private async getTeamIssues(teamKey: string): Promise<LinearIssue[]> {
    const teamId = await this.getTeamIdByKey(teamKey)
    const data = await this.api.request<TeamIssuesResponse>(teamIssuesQuery, {
      id: teamId,
      first: this.config.fetchLimit
    })
    return data.team.issues.nodes
  }

  private async getTeamIdByKey(teamKey: string): Promise<string> {
    const data = await this.api.request<TeamsResponse>(teamsQuery, { first: 100 })
    const team = data.teams.nodes.find((candidate) => candidate.key === teamKey)
    if (!team) throw new Error(`Could not find Linear team with key ${teamKey}`)
    return team.id
  }

  async getWorkflowStateId(teamKey: string, statusName: string): Promise<string> {
    const data = await this.api.request<WorkflowStatesResponse>(workflowStatesQuery, {
      first: 100
    })
    const match = data.workflowStates.nodes.find((state) => state.team?.key === teamKey && state.name === statusName)
    if (!match) throw new Error(`Could not find Linear workflow state "${statusName}" for team ${teamKey}`)
    return match.id
  }

  async claimIssue(issue: LinearIssue): Promise<LinearIssue> {
    const runningStateId = await this.getWorkflowStateId(issue.team.key, this.config.runningStatus)
    await this.updateIssueState(issue.id, runningStateId)
    await this.createComment(issue.id, `Claimed by ${this.config.agentId} at ${new Date().toISOString()}.`)
    const claimed = await this.getIssue(issue.id)
    if (claimed.state.name !== this.config.runningStatus) {
      throw new Error(`Claim verification failed for ${issue.identifier}: state is "${claimed.state.name}"`)
    }
    return claimed
  }

  async getIssue(issueId: string): Promise<LinearIssue> {
    const data = await this.api.request<GetIssueResponse>(getIssueQuery, { id: issueId })
    return data.issue
  }

  private async updateIssueState(issueId: string, stateId: string): Promise<void> {
    const data = await this.api.request<IssueUpdateResponse>(issueUpdateMutation, {
      id: issueId,
      input: { stateId }
    })
    if (!data.issueUpdate.success) throw new Error(`Linear issueUpdate returned success=false for ${issueId}`)
  }

  async createComment(issueId: string, body: string): Promise<void> {
    const data = await this.api.request<CommentCreateResponse>(commentCreateMutation, {
      input: { issueId, body }
    })
    if (!data.commentCreate.success) throw new Error(`Linear commentCreate returned success=false for ${issueId}`)
  }
}
