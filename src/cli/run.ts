import { spawnCodexForIssue } from "../codex.js"
import { claimNextIssue } from "../claim-work/claim-next-issue.js"
import { loadConfig, parseArgs } from "../env.js"
import { printHelp } from "./help.js"

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
