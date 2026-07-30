#!/usr/bin/env node
import { SOURCE_POLICY_SHA256 } from "./policy/source-policy.js"
import { loadRuntimeConfig } from "./runtime/config.js"
import { runUnderExclusiveLock } from "./runtime/process-lock.js"
import { runSteward } from "./runtime/runner.js"
import { runSyntheticCheck } from "./runtime/synthetic-check.js"

const HELP = `Usage: codex-usage-reset-steward <command>

Commands:
  run                  Evaluate policy and, only in approved consume mode, redeem
  policy-digest        Print the source-controlled policy SHA-256
  synthetic-check      Exercise the fake consume state machine; never contacts Codex
  help                 Show this help

Source default: dry-run. There is no force or policy-bypass command.`

async function main(): Promise<number> {
  process.umask(0o077)
  const command = process.argv[2] ?? "run"
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP)
    return 0
  }
  if (command === "policy-digest") {
    console.log(SOURCE_POLICY_SHA256)
    return 0
  }
  if (command !== "run" && command !== "synthetic-check") {
    console.error("error=unknown-command")
    return 64
  }

  let config
  try {
    config = loadRuntimeConfig()
  } catch {
    console.error("result=error code=configuration-invalid")
    return 78
  }
  if (command === "synthetic-check") {
    try {
      await runSyntheticCheck(config)
      console.log("result=synthetic_passed real_consume_calls=0")
      return 0
    } catch {
      console.error("result=error code=synthetic-check-failed")
      return 1
    }
  }
  const lockResult = runUnderExclusiveLock(config.lockFile)
  if (lockResult >= 0) {
    if (lockResult === 75) {
      console.log("result=locked")
      return 0
    }
    return lockResult
  }

  try {
    const output = await runSteward(config)
    console.log(JSON.stringify({
      result: output.result,
      decision: output.decision.consume ? "would_consume" : "do_not_consume",
      reasons: output.decision.reasons,
      workReference: output.decision.workReference,
      creditAvailability: output.decision.creditAvailability,
      exhaustedEligibleBucket: output.decision.exhaustedEligibleBucket
    }))
    return output.result === "error" ? 1 : 0
  } catch {
    console.error("result=error code=steward-failed")
    return 1
  }
}

process.exitCode = await main()
