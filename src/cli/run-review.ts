import { spawnCodexForReview } from "../codex.js"
import { InvalidCodexLaunchOptionsError } from "../codex/options.js"
import { loadConfig, parseArgs } from "../env.js"
import { LinearClient } from "../linear.js"
import { claimNextReview } from "../review/claim-next-review.js"
import { printReviewHelp } from "./help.js"

export async function runReviewCli(argv: string[], cwd: string): Promise<void> {
  const options = parseArgs(argv)

  if (options.flags.help === true) {
    printReviewHelp()
    return
  }

  const config = loadConfig(options, cwd, "review")
  const claimedIssue = await claimNextReview(config)
  if (!claimedIssue) return

  if (config.noSpawn) {
    console.log("--no-spawn enabled; selected review but did not start Codex.")
    return
  }

  try {
    await spawnCodexForReview(config, claimedIssue)
  } catch (error) {
    if (!(error instanceof InvalidCodexLaunchOptionsError)) throw error

    const body = [
      "Could not start Codex review for this issue because the Linear launch labels are invalid.",
      "",
      error.message,
      "",
      `I moved the issue to \`${config.blockedStatus}\` so the labels/model can be corrected before retrying.`,
      "",
      `— ${config.agentId}.`
    ].join("\n")

    if (config.advise) {
      console.error(error.message)
      return
    }

    await new LinearClient(config).blockIssue(claimedIssue, body)
    console.error(error.message)
  }
}
