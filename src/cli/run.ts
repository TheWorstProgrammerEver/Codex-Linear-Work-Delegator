import { spawnCodexForIssue } from "../codex.js"
import { loadConfig, parseArgs } from "../env.js"
import { LinearClient } from "../linear.js"
import { acquireLock } from "../lock.js"
import { getCurrentState } from "../state.js"
import { printHelp } from "./help.js"
import type { Config } from "../env/types.js"
import type { LinearIssue } from "../linear/types.js"

export async function runCli(argv: string[], cwd: string): Promise<void> {
  const options = parseArgs(argv)

  if (options.flags.help === true) {
    printHelp()
    return
  }

  const config = loadConfig(options, cwd)
  const claimedIssue = await claimNextIssue(config)
  if (!claimedIssue) return

  if (config.noSpawn) {
    console.log("--no-spawn enabled; claimed issue but did not start Codex.")
    return
  }

  await spawnCodexForIssue(config, claimedIssue)
}

async function claimNextIssue(config: Config): Promise<LinearIssue | null> {
  const lock = acquireLock(config)

  if (!lock) {
    console.log("Another claim cycle is already running; exiting.")
    return null
  }

  try {
    return await claimNextIssueWithLock(config)
  } finally {
    lock.release()
  }
}

async function claimNextIssueWithLock(config: Config): Promise<LinearIssue | null> {
  const busy = getCurrentState(config)
  if (busy) {
    console.log(`Worker is busy with ${busy.identifier} pid=${busy.pid}; exiting.`)
    return null
  }

  const linear = new LinearClient(config)
  const nextIssue = (await linear.getCandidateIssues())[0]
  if (!nextIssue) {
    console.log("No eligible Linear issues found.")
    return null
  }

  console.log(`Selected ${nextIssue.identifier}: ${nextIssue.title}`)
  if (config.dryRun) {
    console.log("Dry run enabled; not claiming or spawning.")
    return null
  }

  const claimedIssue = await linear.claimIssue(nextIssue)
  console.log(`Claimed ${claimedIssue.identifier}; state=${claimedIssue.state.name}`)
  return claimedIssue
}
