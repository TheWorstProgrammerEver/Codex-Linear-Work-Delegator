export interface EnvMap {
  [key: string]: string | undefined
}

export type LinearAuthConfig =
  | {
    kind: "api-key"
    apiKey: string
  }
  | {
    kind: "oauth-client-credentials"
    clientId: string
    clientSecret: string
    tokenUrl: string
    scopes: string[]
    tokenCacheFile: string
  }

export interface Config {
  linearAuth: LinearAuthConfig
  linearApiUrl: string
  teamKey?: string
  agentId: string
  agentLabels: string[]
  reviewerLabels: string[]
  readyStatus: string
  runningStatus: string
  blockedStatus: string
  reviewStatus: string
  reviewReadyStatus: string
  reviewRunningStatus: string
  reviewPassedStatus: string
  reviewReturnStatus: string
  defaultModel: string
  defaultSandbox: string
  codexBin: string
  codexCwd: string
  codexExecMode: CodexExecMode
  codexExtraArgs: string[]
  stateDir: string
  usageLimitEvidenceFile: string
  waitTimeoutMs: number
  lockStaleMs: number
  fetchLimit: number
  dryRun: boolean
  noSpawn: boolean
  advise: boolean
  reviewIssueId?: string
  reviewArtifactUrl?: string
}

export type CodexExecMode = "attached" | "detached"

export interface CliOptions {
  envFiles: string[]
  flags: Record<string, string | boolean>
}
