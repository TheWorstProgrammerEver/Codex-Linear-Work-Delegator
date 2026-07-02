export interface LinearLabel {
  id: string
  name: string
  parent?: {
    id: string
    name: string
  } | null
}

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  url: string
  description?: string | null
  priority: number
  priorityLabel?: string | null
  createdAt: string
  updatedAt: string
  state: WorkflowState
  labels: {
    nodes: LinearLabel[]
  }
  team: LinearTeam
  comments?: {
    nodes: LinearComment[]
  }
  relations?: {
    nodes: LinearIssueDependency[]
  }
  inverseRelations?: {
    nodes: LinearIssueDependency[]
  }
  assignee?: LinearPerson | null
  creator?: LinearPerson | null
  project?: {
    id: string
    name: string
  } | null
  cycle?: {
    id: string
    name: string
  } | null
}

export interface LinearIssueDependency {
  id: string
  type: string
  issue: LinearIssueDependencyIssue
  relatedIssue: LinearIssueDependencyIssue
}

export interface LinearIssueDependencyIssue {
  identifier: string
  title: string
  url: string
  state: WorkflowState
}

export interface LinearComment {
  id: string
  body: string
  createdAt: string
  updatedAt: string
  user?: LinearPerson | null
}

export interface WorkflowState {
  id: string
  name: string
  type?: string | null
  team?: LinearTeam | null
}

export interface LinearTeam {
  id: string
  key: string
  name: string
}

export interface LinearPerson {
  id: string
  name: string
  email?: string | null
}
