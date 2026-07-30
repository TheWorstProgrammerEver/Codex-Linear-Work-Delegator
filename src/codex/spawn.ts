import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync } from "node:fs"
import { join } from "node:path"
import { captureProcessIdentity } from "../process-identity.js"
import { writeCurrentState } from "../state.js"
import { buildCodexArgs, getCodexLaunchOptions } from "./options.js"
import { buildPrompt } from "./prompt.js"
import { buildReviewPrompt } from "../review/prompt.js"
import { writeReviewRunRecord } from "../review/run-record.js"
import { waitForChildOrTimeout, waitForChildStart } from "./wait.js"
import { StructuredUsageLimitEvidenceLifecycle } from "./usage-limit-evidence.js"
import type { Config } from "../env/types.js"
import type { LinearIssue } from "../linear/types.js"
import type { CurrentState } from "../state.js"
import type { UsageLimitEvidenceLifecycle } from "./usage-limit-evidence.js"

export async function spawnCodexForIssue(
  config: Config,
  issue: LinearIssue,
  evidenceLifecycle: UsageLimitEvidenceLifecycle = new StructuredUsageLimitEvidenceLifecycle(config)
): Promise<void> {
  await spawnCodex(config, issue, buildPrompt(config, issue), "work", evidenceLifecycle)
}

export async function spawnCodexForReview(
  config: Config,
  issue: LinearIssue,
  evidenceLifecycle: UsageLimitEvidenceLifecycle = new StructuredUsageLimitEvidenceLifecycle(config)
): Promise<void> {
  await spawnCodex(config, issue, buildReviewPrompt(config, issue), "review", evidenceLifecycle)
}

async function spawnCodex(
  config: Config,
  issue: LinearIssue,
  prompt: string,
  purpose: "work" | "review",
  evidenceLifecycle: UsageLimitEvidenceLifecycle
): Promise<void> {
  const launchOptions = getCodexLaunchOptions(config, issue)
  evidenceLifecycle.beforeLaunch()
  const logFile = openIssueLog(config.stateDir, issue.identifier)
  const logFd = openSync(logFile, "a")
  const args = buildCodexArgs(config, launchOptions, prompt)

  const child = spawn(config.codexBin, args, {
    cwd: config.codexCwd,
    detached: config.codexExecMode === "detached",
    stdio: ["ignore", logFd, logFd]
  })
  closeSync(logFd)

  const pid = await waitForChildStart(child)
  const currentState = buildCurrentState(issue, pid, launchOptions.model, logFile, purpose)
  writeCurrentState(config, currentState)
  logSpawn(config, currentState, launchOptions.sandbox, launchOptions.reasoningEffort, launchOptions.speed, purpose)

  try {
    const result = await waitForChildOrTimeout(
      config,
      currentState.pid,
      child,
      purpose === "review"
        ? (result) => writeReviewRunRecord(config, currentState, {
            termination: result.signal ? "signaled" : "exited",
            exitCode: result.exitCode,
            signal: result.signal
          })
        : undefined
    )
    if (result.status === "exited") {
      await evidenceLifecycle.afterExit(issue, purpose, logFile)
    }
  } catch (error) {
    if (purpose === "review") {
      writeReviewRunRecord(config, currentState, {
        termination: "process-error",
        exitCode: null,
        signal: null
      })
    }
    throw error
  }
}

function openIssueLog(stateDir: string, issueIdentifier: string): string {
  mkdirSync(join(stateDir, "logs"), { recursive: true })
  return join(stateDir, "logs", `${issueIdentifier}-${Date.now()}.log`)
}

const buildCurrentState = (
  issue: LinearIssue,
  pid: number,
  model: string,
  logFile: string,
  purpose: "work" | "review"
): CurrentState => ({
  issueId: issue.id,
  identifier: issue.identifier,
  url: issue.url,
  pid,
  model,
  startedAt: new Date().toISOString(),
  logFile,
  purpose,
  processIdentity: captureProcessIdentity(pid) ?? undefined
})

function logSpawn(
  config: Config,
  state: CurrentState,
  sandbox: string,
  reasoningEffort?: string,
  speed?: string,
  purpose: "work" | "review" = "work"
): void {
  const reasoning = reasoningEffort ? ` reasoning=${reasoningEffort}` : ""
  const speedOption = speed ? ` speed=${speed}` : ""
  console.log(`Spawned Codex ${purpose} pid=${state.pid} mode=${config.codexExecMode} model=${state.model} sandbox=${sandbox}${reasoning}${speedOption} issue=${state.identifier}`)
  console.log(`Log: ${state.logFile}`)
}
