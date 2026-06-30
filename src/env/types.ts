export interface EnvMap {
  [key: string]: string | undefined
}

export interface Config {
  linearApiKey: string
  linearApiUrl: string
  teamKey?: string
  agentId: string
  agentLabels: string[]
  readyStatus: string
  runningStatus: string
  blockedStatus: string
  reviewStatus: string
  defaultModel: string
  defaultSandbox: string
  codexBin: string
  codexCwd: string
  codexExecMode: CodexExecMode
  codexExtraArgs: string[]
  stateDir: string
  waitTimeoutMs: number
  lockStaleMs: number
  fetchLimit: number
  dryRun: boolean
  noSpawn: boolean
}

export type CodexExecMode = "attached" | "detached"

export interface CliOptions {
  envFiles: string[]
  flags: Record<string, string | boolean>
}
