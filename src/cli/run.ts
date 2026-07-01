import { spawnCodexForIssue } from "../codex.js"
import { claimNextIssue } from "../claim-work/claim-next-issue.js"
import { InvalidCodexLaunchOptionsError } from "../codex/options.js"
import { loadConfig, parseArgs } from "../env.js"
import { LinearClient } from "../linear.js"
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

  try {
    await spawnCodexForIssue(config, claimedIssue)
  } catch (error) {
    if (!(error instanceof InvalidCodexLaunchOptionsError)) throw error

    const body = [
      "Could not start Codex for this issue because the Linear launch labels are invalid.",
      "",
      error.message,
      "",
      `I moved the issue to \`${config.blockedStatus}\` so the labels/model can be corrected before retrying.`,
      "",
      `— ${config.agentId}.`
    ].join("\n")

    await new LinearClient(config).blockIssue(claimedIssue, body)
    console.error(error.message)
  }
}
