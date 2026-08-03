import { resolve } from "node:path"
import { mergeEnvFile } from "./env/files.js"
import { parseArgs } from "./env/args.js"
import type { CliOptions, CodexExecMode, Config, EnvMap } from "./env/types.js"

export { parseArgs }

const FLAG_ENV_KEYS = [
  ["linear-api-key", "LINEAR_API_KEY"],
  ["linear-auth-mode", "CODEX_LINEAR_AUTH_MODE"],
  ["linear-api-url", "CODEX_LINEAR_API_URL"],
  ["team-key", "CODEX_LINEAR_TEAM_KEY"],
  ["agent-id", "CODEX_LINEAR_AGENT_ID"],
  ["agent-labels", "CODEX_LINEAR_AGENT_LABELS"],
  ["reviewer-labels", "CODEX_LINEAR_REVIEWER_LABELS"],
  ["ready-status", "CODEX_LINEAR_READY_STATUS"],
  ["running-status", "CODEX_LINEAR_RUNNING_STATUS"],
  ["blocked-status", "CODEX_LINEAR_BLOCKED_STATUS"],
  ["review-status", "CODEX_LINEAR_REVIEW_STATUS"],
  ["review-ready-status", "CODEX_LINEAR_REVIEW_READY_STATUS"],
  ["review-running-status", "CODEX_LINEAR_REVIEW_RUNNING_STATUS"],
  ["review-passed-status", "CODEX_LINEAR_REVIEW_PASSED_STATUS"],
  ["review-return-status", "CODEX_LINEAR_REVIEW_RETURN_STATUS"],
  ["default-model", "CODEX_LINEAR_DEFAULT_MODEL"],
  ["default-sandbox", "CODEX_LINEAR_DEFAULT_SANDBOX"],
  ["codex-bin", "CODEX_LINEAR_CODEX_BIN"],
  ["codex-cwd", "CODEX_LINEAR_CODEX_CWD"],
  ["codex-exec-mode", "CODEX_LINEAR_CODEX_EXEC_MODE"],
  ["codex-extra-args", "CODEX_LINEAR_CODEX_EXTRA_ARGS"],
  ["state-dir", "CODEX_LINEAR_STATE_DIR"],
  ["usage-limit-evidence-file", "CODEX_LINEAR_USAGE_LIMIT_EVIDENCE_FILE"],
  ["wait-timeout-seconds", "CODEX_LINEAR_WAIT_TIMEOUT_SECONDS"],
  ["lock-stale-seconds", "CODEX_LINEAR_LOCK_STALE_SECONDS"],
  ["fetch-limit", "CODEX_LINEAR_FETCH_LIMIT"],
  ["issue-id", "CODEX_LINEAR_REVIEW_ISSUE_ID"],
  ["artifact-url", "CODEX_LINEAR_REVIEW_ARTIFACT_URL"]
] as const

export type ConfigProfile = "work" | "review"

export function loadConfig(options: CliOptions, cwd: string, profile: ConfigProfile = "work"): Config {
  const merged: EnvMap = {}

  mergeEnvFile(merged, resolve(cwd, ".env.defaults"), false)
  mergeEnvFile(merged, resolve(cwd, ".env.local"), false)
  options.envFiles.forEach((envFile) => mergeEnvFile(merged, resolve(cwd, envFile), true))
  Object.assign(merged, process.env)
  applyFlags(merged, options.flags)

  const agentId = value(merged, "CODEX_LINEAR_AGENT_ID", "anonymous")
  const reviewStatus = value(merged, "CODEX_LINEAR_REVIEW_STATUS", "In Review")
  const stateDir = pathValue(merged, "CODEX_LINEAR_STATE_DIR", defaultStateDir(profile))
  const readyStatus = value(merged, "CODEX_LINEAR_READY_STATUS", "Waiting For Agent")

  return {
    linearAuth: linearAuthConfig(merged, stateDir),
    linearApiUrl: value(merged, "CODEX_LINEAR_API_URL", "https://api.linear.app/graphql"),
    teamKey: optional(merged, "CODEX_LINEAR_TEAM_KEY"),
    agentId,
    agentLabels: list(value(merged, "CODEX_LINEAR_AGENT_LABELS", "agent:any")),
    reviewerLabels: list(value(merged, "CODEX_LINEAR_REVIEWER_LABELS", `reviewer:${agentId},reviewer:any`)),
    readyStatus,
    runningStatus: value(merged, "CODEX_LINEAR_RUNNING_STATUS", "Agent In Progress"),
    blockedStatus: value(merged, "CODEX_LINEAR_BLOCKED_STATUS", "Blocked"),
    reviewStatus,
    reviewReadyStatus: value(merged, "CODEX_LINEAR_REVIEW_READY_STATUS", reviewStatus),
    reviewRunningStatus: value(merged, "CODEX_LINEAR_REVIEW_RUNNING_STATUS", "Agent Reviewing"),
    reviewPassedStatus: value(merged, "CODEX_LINEAR_REVIEW_PASSED_STATUS", "Review Passed"),
    reviewReturnStatus: value(merged, "CODEX_LINEAR_REVIEW_RETURN_STATUS", readyStatus),
    defaultModel: value(merged, "CODEX_LINEAR_DEFAULT_MODEL", "gpt-5.5"),
    defaultSandbox: value(merged, "CODEX_LINEAR_DEFAULT_SANDBOX", "danger-full-access"),
    codexBin: value(merged, "CODEX_LINEAR_CODEX_BIN", "codex"),
    codexCwd: pathValue(merged, "CODEX_LINEAR_CODEX_CWD", process.cwd()),
    codexExecMode: codexExecMode(merged, "CODEX_LINEAR_CODEX_EXEC_MODE", "attached"),
    codexExtraArgs: splitArgs(value(merged, "CODEX_LINEAR_CODEX_EXTRA_ARGS", "")),
    stateDir,
    usageLimitEvidenceFile: pathValue(
      merged,
      "CODEX_LINEAR_USAGE_LIMIT_EVIDENCE_FILE",
      defaultUsageLimitEvidenceFile()
    ),
    waitTimeoutMs: seconds(merged, "CODEX_LINEAR_WAIT_TIMEOUT_SECONDS", 60),
    lockStaleMs: seconds(merged, "CODEX_LINEAR_LOCK_STALE_SECONDS", 600),
    fetchLimit: integer(merged, "CODEX_LINEAR_FETCH_LIMIT", 50),
    dryRun: options.flags["dry-run"] === true,
    noSpawn: options.flags["no-spawn"] === true,
    advise: options.flags.advise === true,
    reviewIssueId: optional(merged, "CODEX_LINEAR_REVIEW_ISSUE_ID"),
    reviewArtifactUrl: optional(merged, "CODEX_LINEAR_REVIEW_ARTIFACT_URL")
  }
}

function linearAuthConfig(env: EnvMap, stateDir: string): Config["linearAuth"] {
  const mode = value(env, "CODEX_LINEAR_AUTH_MODE", "auto")
  if (mode !== "auto" && mode !== "oauth" && mode !== "api-key") {
    throw new Error('CODEX_LINEAR_AUTH_MODE must be "auto", "oauth", or "api-key"')
  }

  const clientId = optional(env, "LINEAR_OAUTH_CLIENT_ID")
  const clientSecret = optional(env, "LINEAR_OAUTH_CLIENT_SECRET")
  const hasPartialOAuth = Boolean(clientId) !== Boolean(clientSecret)
  if (hasPartialOAuth) {
    throw new Error("LINEAR_OAUTH_CLIENT_ID and LINEAR_OAUTH_CLIENT_SECRET must be configured together")
  }

  if (mode !== "api-key" && clientId && clientSecret) {
    const scopes = list(value(env, "CODEX_LINEAR_OAUTH_SCOPES", "read,write"))
    if (scopes.length === 0) throw new Error("CODEX_LINEAR_OAUTH_SCOPES must include at least one scope")
    return {
      kind: "oauth-client-credentials",
      clientId,
      clientSecret,
      tokenUrl: value(env, "CODEX_LINEAR_OAUTH_TOKEN_URL", "https://api.linear.app/oauth/token"),
      scopes,
      tokenCacheFile: pathValue(
        env,
        "CODEX_LINEAR_OAUTH_TOKEN_CACHE_FILE",
        `${stateDir}/secrets/linear-oauth-token.json`
      )
    }
  }

  if (mode === "oauth") {
    throw new Error("OAuth mode requires LINEAR_OAUTH_CLIENT_ID and LINEAR_OAUTH_CLIENT_SECRET")
  }

  const apiKey = optional(env, "LINEAR_API_KEY")
  if (apiKey) return { kind: "api-key", apiKey }
  throw new Error(
    "Missing Linear credentials: configure both LINEAR_OAUTH_CLIENT_ID and LINEAR_OAUTH_CLIENT_SECRET, or LINEAR_API_KEY"
  )
}

function defaultStateDir(profile: ConfigProfile): string {
  const name = profile === "review"
    ? "codex-linear-review-delegator"
    : "codex-linear-work-delegator"
  return `${process.env.HOME ?? "."}/.local/state/${name}`
}

function defaultUsageLimitEvidenceFile(): string {
  return `${process.env.HOME ?? "."}/.local/state/codex-usage-reset-steward/usage-limit-blocked.json`
}

function applyFlags(env: EnvMap, flags: CliOptions["flags"]): void {
  FLAG_ENV_KEYS.forEach(([flag, key]) => {
    const flagValue = flags[flag]
    if (typeof flagValue === "string") env[key] = flagValue
  })
}

function required(env: EnvMap, key: string): string {
  const found = optional(env, key)
  if (!found) throw new Error(`Missing required configuration: ${key}`)
  return found
}

const optional = (env: EnvMap, key: string): string | undefined => {
  const found = env[key]?.trim()
  return found ? found : undefined
}

const value = (env: EnvMap, key: string, fallback: string): string =>
  optional(env, key) ?? fallback

const pathValue = (env: EnvMap, key: string, fallback: string): string =>
  expandHomePath(value(env, key, fallback))

function expandHomePath(input: string): string {
  const home = process.env.HOME
  if (!home) return input

  if (input === "~" || input === "$HOME" || input === "${HOME}") return home
  if (input.startsWith("~/")) return `${home}${input.slice(1)}`
  if (input.startsWith("$HOME/")) return `${home}${input.slice("$HOME".length)}`
  if (input.startsWith("${HOME}/")) return `${home}${input.slice("${HOME}".length)}`

  return input
}

const list = (input: string): string[] =>
  input.split(",").map((item) => item.trim()).filter(Boolean)

const seconds = (env: EnvMap, key: string, fallback: number): number =>
  integer(env, key, fallback) * 1000

function codexExecMode(env: EnvMap, key: string, fallback: CodexExecMode): CodexExecMode {
  const raw = value(env, key, fallback)
  if (raw === "attached" || raw === "detached") return raw
  throw new Error(`${key} must be "attached" or "detached"`)
}

function integer(env: EnvMap, key: string, fallback: number): number {
  const raw = optional(env, key)
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${key} must be a non-negative integer`)
  return parsed
}

const splitArgs = (input: string): string[] =>
  input.split(/\s+/).map((item) => item.trim()).filter(Boolean)
