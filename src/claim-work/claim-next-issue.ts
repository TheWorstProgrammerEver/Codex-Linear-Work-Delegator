import { LinearClient } from "../linear.js"
import { checkAbandonedRunningWork } from "./abandoned-running-work.js"
import { acquireLock } from "../lock.js"
import { getCurrentState } from "../state.js"
import { getUnresolvedBlockers } from "../linear/dependencies.js"
import { reportReadinessFailure } from "../codex/readiness-comment.js"
import { checkCodexReadiness, type CodexReadinessDescriptor, type CodexReadinessResult } from "../codex/readiness.js"
import { getCodexModel } from "../codex/options.js"
import { reconcileUsageLimitEvidence } from "../codex/usage-limit-evidence.js"
import type { Config } from "../env/types.js"
import type { LinearIssue } from "../linear/types.js"

type ReadinessCheck = (descriptor: CodexReadinessDescriptor) => Promise<CodexReadinessResult>

export interface WorkLinearClient {
  getCandidateIssues(): Promise<LinearIssue[]>
  getRunningIssues(): Promise<LinearIssue[]>
  getIssue(issueId: string): Promise<LinearIssue>
  claimIssue(issue: LinearIssue): Promise<LinearIssue>
  createComment(issueId: string, body: string): Promise<void>
}

export async function claimNextIssue(
  config: Config,
  readinessCheck: ReadinessCheck = checkCodexReadiness,
  linear: WorkLinearClient = new LinearClient(config)
): Promise<LinearIssue | null> {
  const lock = acquireLock(config)

  if (!lock) {
    console.log("Another claim cycle is already running; exiting.")
    return null
  }

  try {
    return await claimNextIssueWithLock(config, readinessCheck, linear)
  } finally {
    lock.release()
  }
}

async function claimNextIssueWithLock(
  config: Config,
  readinessCheck: ReadinessCheck,
  linear: WorkLinearClient
): Promise<LinearIssue | null> {
  const busy = getCurrentState(config)
  if (busy) {
    console.log(`Worker is busy with ${busy.identifier} pid=${busy.pid}; exiting.`)
    return null
  }

  await reconcileUsageLimitEvidence(config, linear)
  if (await checkAbandonedRunningWork(config, linear)) return null

  const nextIssue = (await linear.getCandidateIssues()).find((issue) => {
    const blockers = getUnresolvedBlockers(issue)
    if (blockers.length === 0) return true

    console.log(
      `Skipping ${issue.identifier}; blocked by unresolved dependencies: ${blockers.map((blocker) => blocker.identifier).join(", ")}.`
    )
    return false
  })

  if (!nextIssue) {
    console.log("No eligible Linear issues found.")
    return null
  }

  console.log(`Selected ${nextIssue.identifier}: ${nextIssue.title}`)
  if (config.dryRun) {
    console.log("Dry run enabled; not claiming or spawning.")
    return null
  }

  if (!config.noSpawn) {
    const readiness = await readinessCheck({
      codexBin: config.codexBin,
      model: getCodexModel(config, nextIssue)
    })
    if (!readiness.ready) {
      await reportReadinessFailure(config, linear, nextIssue, readiness, "work")
      console.error(`Codex readiness failed for ${nextIssue.identifier}; code=${readiness.code}; issue was not claimed.`)
      return null
    }
  }

  const claimedIssue = await linear.claimIssue(nextIssue)
  console.log(`Claimed ${claimedIssue.identifier}; state=${claimedIssue.state.name}`)
  return claimedIssue
}
