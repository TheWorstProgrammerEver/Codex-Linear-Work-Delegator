export interface EnvMap {
  [key: string]: string | undefined;
}

export interface Config {
  linearApiKey: string;
  linearApiUrl: string;
  teamKey?: string;
  agentId: string;
  agentLabels: string[];
  readyStatus: string;
  runningStatus: string;
  blockedStatus: string;
  reviewStatus: string;
  defaultModel: string;
  defaultSandbox: string;
  codexBin: string;
  codexCwd: string;
  codexExtraArgs: string[];
  stateDir: string;
  waitTimeoutMs: number;
  lockStaleMs: number;
  fetchLimit: number;
  dryRun: boolean;
  noSpawn: boolean;
}

export interface CliOptions {
  envFiles: string[];
  flags: Record<string, string | boolean>;
}

export interface LinearLabel {
  id: string;
  name: string;
  parent?: {
    id: string;
    name: string;
  } | null;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description?: string | null;
  priority: number;
  priorityLabel?: string | null;
  createdAt: string;
  updatedAt: string;
  state: {
    id: string;
    name: string;
    type?: string | null;
  };
  labels: {
    nodes: LinearLabel[];
  };
  team: {
    id: string;
    key: string;
    name: string;
  };
  comments?: {
    nodes: LinearComment[];
  };
  assignee?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;
  creator?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;
  project?: {
    id: string;
    name: string;
  } | null;
  cycle?: {
    id: string;
    name: string;
  } | null;
}

export interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;
}

export interface WorkflowState {
  id: string;
  name: string;
  type?: string | null;
  team?: {
    id: string;
    key: string;
    name: string;
  } | null;
}

export interface CurrentState {
  issueId: string;
  identifier: string;
  url: string;
  pid: number;
  model: string;
  startedAt: string;
  logFile: string;
}
