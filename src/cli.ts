#!/usr/bin/env node
import { acquireLock } from "./lock.js";
import { LinearClient } from "./linear.js";
import { getCurrentState } from "./state.js";
import { loadConfig, parseArgs } from "./env.js";
import { spawnCodexForIssue } from "./codex.js";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.flags.help === true) {
    printHelp();
    return;
  }

  const config = loadConfig(options, process.cwd());

  const lock = acquireLock(config);
  if (!lock) {
    console.log("Another claim cycle is already running; exiting.");
    return;
  }

  let claimedIssue = null;
  try {
    const busy = getCurrentState(config);
    if (busy) {
      console.log(`Worker is busy with ${busy.identifier} pid=${busy.pid}; exiting.`);
      return;
    }

    const linear = new LinearClient(config);
    const candidates = await linear.getCandidateIssues();
    const nextIssue = candidates[0];
    if (!nextIssue) {
      console.log("No eligible Linear issues found.");
      return;
    }

    console.log(`Selected ${nextIssue.identifier}: ${nextIssue.title}`);
    if (config.dryRun) {
      console.log("Dry run enabled; not claiming or spawning.");
      return;
    }

    claimedIssue = await linear.claimIssue(nextIssue);
    console.log(`Claimed ${claimedIssue.identifier}; state=${claimedIssue.state.name}`);
  } finally {
    lock.release();
  }

  if (!claimedIssue) return;
  if (config.noSpawn) {
    console.log("--no-spawn enabled; claimed issue but did not start Codex.");
    return;
  }

  await spawnCodexForIssue(config, claimedIssue);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

function printHelp(): void {
  console.log(`Usage: codex-linear-work-delegator [options]

Poll Linear, claim one eligible issue, then spawn Codex for that issue.

Options:
  --env-file <path>              Load an additional env file.
  --dry-run                      Find the next issue but do not claim or spawn.
  --no-spawn                     Claim the issue but do not spawn Codex.
  --wait-timeout-seconds <sec>   Wait this long for Codex before returning. Default: 60.
  --team-key <key>               Restrict polling to a Linear team key.
  --agent-id <id>                Agent id used in claim comments.
  --agent-labels <csv>           Eligible assignment labels.
  --ready-status <name>          Eligible Linear status.
  --running-status <name>        Claimed Linear status.
  --default-model <model>        Codex model when no agent:model label is present.
  --default-sandbox <mode>       Codex sandbox when no agent:sandbox label is present.
  --codex-cwd <path>             Working directory for codex exec.
  --state-dir <path>             Local worker state directory.
  --help                         Show this help.
`);
}
