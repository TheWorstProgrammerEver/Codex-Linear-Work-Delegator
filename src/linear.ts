import { compareIssues } from "./linear/compare.js"
import { LinearGraphQLClient } from "./linear/graphql.js"
import { matchesLabel } from "./linear/labels.js"
import { candidateIssuesQuery, type CandidateIssuesResponse } from "./linear/queries/candidate-issues.js"
import { commentCreateMutation, type CommentCreateResponse } from "./linear/queries/comment-create.js"
import { getIssueQuery, type GetIssueResponse } from "./linear/queries/get-issue.js"
import { issueUpdateMutation, type IssueUpdateResponse } from "./linear/queries/issue-update.js"
import { reviewFilteredIssuesAllTeamsQuery, type ReviewFilteredIssuesAllTeamsResponse } from "./linear/queries/review-filtered-issues-all-teams.js"
import { reviewFilteredIssuesQuery, type ReviewFilteredIssuesResponse } from "./linear/queries/review-filtered-issues.js"
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
    const issues = await this.getFilteredIssues(this.config.readyStatus, issueLabelFilterNames(this.config.agentLabels))

    const candidates = issues.filter((issue) => {
      if (this.config.teamKey && issue.team.key !== this.config.teamKey) return false
      if (issue.state.name !== this.config.readyStatus) return false
      return this.config.agentLabels.some((agentLabel) => issue.labels.nodes.some((label) => matchesLabel(label, agentLabel)))
    })

    return candidates.sort(compareIssues)
  }

  async getReviewCandidateIssues(): Promise<LinearIssue[]> {
    return this.getFilteredReviewIssues(this.config.reviewReadyStatus)
  }

  async getRunningIssues(): Promise<LinearIssue[]> {
    return (await this.getFilteredIssues(this.config.runningStatus, healthCheckLabelFilterNames(this.config))).filter((issue) => {
      if (this.config.teamKey && issue.team.key !== this.config.teamKey) return false
      return issue.state.name === this.config.runningStatus
    })
  }

  async getReviewRunningIssues(): Promise<LinearIssue[]> {
    return this.getFilteredReviewIssues(this.config.reviewRunningStatus)
  }

  private async getFilteredIssues(statusName: string, labelNames: string[]): Promise<LinearIssue[]> {
    return this.config.teamKey
      ? this.getTeamIssues(this.config.teamKey, statusName, labelNames)
      : this.getAllVisibleIssues(statusName, labelNames)
  }

  private async getAllVisibleIssues(statusName: string, labelNames: string[]): Promise<LinearIssue[]> {
    return this.collectIssuePages(async (after) => {
      const data = await this.api.request<CandidateIssuesResponse>(candidateIssuesQuery, {
        first: this.config.fetchLimit,
        after,
        statusName,
        labelNames
      })
      return data.issues
    })
  }

  private async getTeamIssues(teamKey: string, statusName: string, labelNames: string[]): Promise<LinearIssue[]> {
    return this.collectIssuePages(async (after) => {
      const data = await this.api.request<TeamIssuesResponse>(teamIssuesQuery, {
        first: this.config.fetchLimit,
        after,
        teamKey,
        statusName,
        labelNames
      })
      return data.issues
    })
  }

  private async collectIssuePages(
    requestPage: (after: string | null) => Promise<CandidateIssuesResponse["issues"]>
  ): Promise<LinearIssue[]> {
    const issues: LinearIssue[] = []
    let after: string | null = null
    let hasNextPage = true

    do {
      const page = await requestPage(after)
      issues.push(...page.nodes)
      after = page.pageInfo.endCursor
      hasNextPage = page.pageInfo.hasNextPage

      if (hasNextPage && !after) {
        throw new Error("Linear issue page reported hasNextPage=true without endCursor")
      }
    } while (hasNextPage)

    return issues
  }

  private async getFilteredReviewIssues(statusName: string): Promise<LinearIssue[]> {
    const data = await this.getFilteredReviewIssuePage(statusName)

    const candidates = data.issues.nodes.filter((issue) =>
      issue.state.name === statusName &&
      (!this.config.teamKey || issue.team.key === this.config.teamKey) &&
      this.config.reviewerLabels.some((reviewerLabel) => issue.labels.nodes.some((label) => matchesLabel(label, reviewerLabel)))
    )

    return candidates.sort(compareIssues)
  }

  private async getFilteredReviewIssuePage(statusName: string): Promise<ReviewFilteredIssuesResponse | ReviewFilteredIssuesAllTeamsResponse> {
    const commonVariables = {
      first: this.config.fetchLimit,
      statusName,
      labelNames: reviewLabelFilterNames(this.config.reviewerLabels)
    }

    if (!this.config.teamKey) {
      return this.api.request<ReviewFilteredIssuesAllTeamsResponse>(reviewFilteredIssuesAllTeamsQuery, commonVariables)
    }

    return this.api.request<ReviewFilteredIssuesResponse>(reviewFilteredIssuesQuery, {
      ...commonVariables,
      teamKey: this.config.teamKey
    })
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

  async claimReviewIssue(issue: LinearIssue): Promise<LinearIssue> {
    const runningStateId = await this.getWorkflowStateId(issue.team.key, this.config.reviewRunningStatus)
    await this.updateIssueState(issue.id, runningStateId)
    await this.createComment(issue.id, `Review claimed by ${this.config.agentId} at ${new Date().toISOString()}.`)
    const claimed = await this.getIssue(issue.id)
    if (claimed.state.name !== this.config.reviewRunningStatus) {
      throw new Error(`Review claim verification failed for ${issue.identifier}: state is "${claimed.state.name}"`)
    }
    return claimed
  }

  async blockIssue(issue: LinearIssue, body: string): Promise<void> {
    const blockedStateId = await this.getWorkflowStateId(issue.team.key, this.config.blockedStatus)
    await this.updateIssueState(issue.id, blockedStateId)
    await this.createComment(issue.id, body)
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

const issueLabelFilterNames = (labels: string[]): string[] =>
  [...new Set(labels.flatMap((label) => {
    const [, childName] = label.split(":", 2)
    return childName ? [label, childName] : [label]
  }))]

const reviewLabelFilterNames = issueLabelFilterNames

const healthCheckLabelFilterNames = (config: Config): string[] =>
  issueLabelFilterNames([`agent:${config.agentId}`, "agent:any"])
